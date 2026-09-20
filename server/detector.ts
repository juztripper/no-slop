import { createHash } from 'node:crypto';
import type { AnalyzeResponse, ContentItem, Verdict } from '../src/shared/contracts.js';
import type { Config } from './config.js';
import { DailyBudget, ExpiringCache, ServiceError, WorkGate } from './limits.js';
import { OpenRouterProvider, POLICY_VERSION, type Decision, type VisualEvidence } from './provider.js';
import { downloadPublic, extractDestination } from './safe-fetch.js';

export interface InspectionOptions { inspectThumbnails: boolean; inspectDestinations: boolean }
export interface Provider { decide(record: unknown, signal?: AbortSignal): Promise<Decision>; describeImage(image: Awaited<ReturnType<typeof downloadPublic>>, signal?: AbortSignal): Promise<VisualEvidence> }
type Detection = { verdict: Verdict; warnings: string[] };

export function verdictFromDecision(item: ContentItem, decision: Decision, evidence: Verdict['evidence']): Verdict {
  const lowQuality = decision.answers.low_quality.noul;
  const synthetic = decision.answers.synthetic.noul;
  const clickbait = decision.answers.clickbait.noul;
  const sufficient = decision.answers.enough_evidence.noul;
  let category: Verdict['category'] = 'uncertain'; let confidence = 0;
  const reasons: string[] = [];
  // The model directly scores the visible item's quality. Sufficiency is an
  // abstention gate; authorship selects a category, not a second quality penalty.
  // These scores are not calibrated statistical probabilities.
  if (sufficient >= 0.7 && lowQuality >= 0.6) {
    confidence = lowQuality;
    if (synthetic >= 0.85) {
      category = 'ai-slop';
      reasons.push('Likely low-value content with signs of synthetic generation.');
    } else if (synthetic <= 0.25) {
      category = 'human-slop';
      reasons.push('Likely low-value content or spam. Its authorship is unknown.');
    } else {
      category = 'slop';
      reasons.push('Likely low-value content; its authorship is unclear.');
    }
  } else if (lowQuality <= 0.25 && sufficient >= 0.7) {
    category = 'quality'; confidence = Math.max(0, sufficient - lowQuality);
    reasons.push('No strong quality problem found in the available evidence.');
  } else reasons.push(sufficient < 0.7 ? 'Not enough context to judge fairly.' : 'The evidence is mixed. Content is kept.');
  if (clickbait >= 0.85) reasons.push('The model found signs of a misleading hook or engagement bait.');
  if (synthetic >= 0.85 && lowQuality < 0.6) reasons.push('Possible AI use alone is not a reason to filter.');
  if (evidence.thumbnail) reasons.push('Thumbnail inspected with a vision model.');
  if (evidence.destination) reasons.push('Public destination text inspected.');
  return { id: item.id, category, confidence: Math.round(confidence * 1_000_000) / 1_000_000, reasons, signals: { lowQuality, synthetic, clickbait }, evidence, model: decision.model };
}

export class Detector {
  private readonly cache: ExpiringCache<Detection>;
  private readonly pending = new Map<string, Promise<Detection>>();
  private readonly gate: WorkGate;
  private readonly provider: Provider;
  constructor(private readonly config: Config, provider?: Provider, private readonly downloader = downloadPublic) {
    this.cache = new ExpiringCache(config.cacheEntries, config.cacheTtlMs);
    this.gate = new WorkGate(config.maxConcurrent, config.maxPending);
    this.provider = provider || new OpenRouterProvider(config, new DailyBudget(config.dailyCallBudget, config.budgetFile));
  }
  async analyze(items: ContentItem[], options: InspectionOptions): Promise<AnalyzeResponse> {
    const results = await Promise.all(items.map(async item => {
      try {
        const { verdict, warnings } = await this.inspect(item, options);
        return { verdict: { ...verdict, id: item.id }, errors: warnings.map(message => ({ id: item.id, message })) };
      } catch (error) {
        return { errors: [{ id: item.id, message: error instanceof ServiceError ? error.publicMessage : 'This item could not be inspected. Content was kept.' }] };
      }
    }));
    return { verdicts: results.flatMap(result => result.verdict ? [result.verdict] : []), errors: results.flatMap(result => result.errors) };
  }
  private async inspect(item: ContentItem, options: InspectionOptions): Promise<Detection> {
    const { id: _id, thumbnailUrl: _thumbnail, ...content } = item;
    const key = createHash('sha256').update(JSON.stringify({ content, inspectDestinations:options.inspectDestinations, policy: POLICY_VERSION, jev: this.config.jevModel })).digest('hex');
    const cached = this.cache.get(key); if (cached) return cached;
    const existing = this.pending.get(key); if (existing) return existing;
    if (this.pending.size >= this.config.maxConcurrent + this.config.maxPending) throw new ServiceError('Detector is busy. Content was kept.', 429);
    // Includes queue time. Every network stage receives the same deadline, so a
    // timed-out browser request cannot leave queued paid work running behind it.
    const signal = AbortSignal.timeout(25000);
    const operation = this.gate.run(async () => {
      const warnings: string[] = [];
      const evidence: Verdict['evidence'] = { text: Boolean(item.title.trim() || item.text.trim()), thumbnail: false, destination: false };
      let destination: ReturnType<typeof extractDestination> | undefined;
      if (options.inspectDestinations && item.kind === 'search' && item.url) {
        try {
          const page = await this.downloader(item.url, 'html', signal);
          destination = extractDestination(page.bytes.toString('utf8')); evidence.destination = true;
        } catch { warnings.push('Destination could not be inspected; only the search preview was assessed.'); }
      }
      signal.throwIfAborted();
      const decision = await this.provider.decide({ platform: item.platform, kind: item.kind, title: item.title, text: item.text, context: item.context || '', destination, destinationStatus: destination ? 'available' : warnings.length ? 'unavailable; judge only the supplied text' : 'not requested' }, signal);
      const verdict = verdictFromDecision(item, decision, evidence);
      // Failed enrichment is not evidence against a site. The model must judge
      // only available text; its sufficiency gate decides whether to abstain.
      const result = { verdict, warnings };
      if (!warnings.length) this.cache.set(key, result);
      return result;
    }, signal);
    this.pending.set(key, operation);
    try { return await operation; } finally { this.pending.delete(key); }
  }
}
