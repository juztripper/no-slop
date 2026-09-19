import { createHash } from 'node:crypto';
import type { AnalyzeResponse, ContentItem, Verdict } from '../src/shared/contracts.js';
import type { Config } from './config.js';
import { DailyBudget, ExpiringCache, ServiceError, WorkGate } from './limits.js';
import { OpenRouterProvider, POLICY_VERSION, type Decision, type VisualEvidence } from './provider.js';
import { downloadPublic, extractDestination, isAllowedThumbnail } from './safe-fetch.js';

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
  // Conservative joint lower bounds, without assuming independent questions.
  // P(A and B) >= P(A)+P(B)-1. Product would assert unverified independence.
  const poorEvidence = Math.max(0, lowQuality + sufficient - 1);
  if (poorEvidence >= 0.6) {
    if (synthetic >= 0.85) {
      category = 'ai-slop'; confidence = Math.max(0, lowQuality + sufficient + synthetic - 2);
      reasons.push('Likely low-value content with signs of synthetic generation.');
    } else if (synthetic <= 0.25) {
      category = 'human-slop'; confidence = poorEvidence;
      reasons.push('Likely low-value content or spam. Its authorship is unknown.');
    } else {
      category = 'slop'; confidence = poorEvidence;
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
    const { id: _id, ...content } = item;
    const key = createHash('sha256').update(JSON.stringify({ content, options, policy: POLICY_VERSION, jev: this.config.jevModel, vision: this.config.visionModel })).digest('hex');
    const cached = this.cache.get(key); if (cached) return cached;
    const existing = this.pending.get(key); if (existing) return existing;
    if (this.pending.size >= this.config.maxConcurrent + this.config.maxPending) throw new ServiceError('Detector is busy. Content was kept.', 429);
    // Includes queue time. Every network stage receives the same deadline, so a
    // timed-out browser request cannot leave queued paid work running behind it.
    const signal = AbortSignal.timeout(25000);
    const operation = this.gate.run(async () => {
      const warnings: string[] = [];
      const evidence: Verdict['evidence'] = { text: Boolean(item.title.trim() || item.text.trim()), thumbnail: false, destination: false };
      let thumbnail: VisualEvidence | undefined;
      let destination: ReturnType<typeof extractDestination> | undefined;
      if (options.inspectThumbnails && item.thumbnailUrl) {
        if (!isAllowedThumbnail(item.thumbnailUrl)) warnings.push('Thumbnail host is unsupported; only text was assessed.');
        else {
          try { thumbnail = await this.provider.describeImage(await this.downloader(item.thumbnailUrl, 'image', signal), signal); evidence.thumbnail = true; }
          catch { warnings.push('Thumbnail could not be inspected; only available evidence was assessed.'); }
        }
      }
      if (options.inspectDestinations && item.kind === 'search' && item.url) {
        try {
          const page = await this.downloader(item.url, 'html', signal);
          destination = extractDestination(page.bytes.toString('utf8')); evidence.destination = true;
        } catch { warnings.push('Destination could not be inspected; only the search preview was assessed.'); }
      }
      signal.throwIfAborted();
      const decision = await this.provider.decide({ platform: item.platform, kind: item.kind, title: item.title, text: item.text, context: item.context || '', thumbnail, destination }, signal);
      const verdict = verdictFromDecision(item, decision, evidence);
      // Missing requested context is not silently treated as full evidence. Keep
      // borderline results visible until inspection succeeds on a later request.
      if (warnings.length && ['ai-slop', 'human-slop', 'slop'].includes(verdict.category)) {
        verdict.category = 'uncertain'; verdict.confidence = 0;
        verdict.reasons.unshift('Requested evidence was unavailable. Content is kept.');
        verdict.reasons = verdict.reasons.slice(0, 6);
      }
      const result = { verdict, warnings };
      if (!warnings.length) this.cache.set(key, result);
      return result;
    }, signal);
    this.pending.set(key, operation);
    try { return await operation; } finally { this.pending.delete(key); }
  }
}
