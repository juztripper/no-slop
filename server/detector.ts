import { createHash } from 'node:crypto';
import type { AnalyzeResponse, ContentItem, Verdict } from '../src/shared/contracts.js';
import type { Config } from './config.js';
import { DailyBudget, ExpiringCache, ServiceError, WorkGate } from './limits.js';
import { OpenRouterProvider, POLICY_VERSION, type Decision, type VisualEvidence } from './provider.js';
import { downloadPublic, extractDestination } from './safe-fetch.js';

export interface InspectionOptions { inspectThumbnails: boolean; inspectDestinations: boolean }
export interface Provider { decide(record: unknown, signal?: AbortSignal): Promise<Decision>; describeImage(image: Awaited<ReturnType<typeof downloadPublic>>, signal?: AbortSignal): Promise<VisualEvidence> }
type Detection = { verdict: Verdict; warnings: string[] };

export { verdictFromDecision } from '../src/shared/decision.js';
import { verdictFromDecision } from '../src/shared/decision.js';

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
