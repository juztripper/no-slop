import { AnalysisDeferredSchema, AnalyzeResponseSchema, DEFAULT_SETTINGS, EMPTY_STATS, isAllowlisted, shouldFilter, type PageStats, type RuntimeMessage, type Settings, type Verdict } from '../shared/contracts';
import { extractCandidates, isEligibleContentUnit, isPrivatePage, platformForUrl, type Candidate } from './adapters';
import { presentCandidate, type Presentation } from './presentation';

export interface RuntimeBridge { send(message: RuntimeMessage): Promise<unknown>; }
interface RecordState { candidate: Candidate; verdict?: Verdict; presentation?: Presentation; state: 'waiting' | 'queued' | 'done' | 'error'; }

/** One visible batch at a time, with bounded page state and generation-checked async work. */
export class ContentController {
  private settings: Settings = DEFAULT_SETTINGS;
  private records = new Map<HTMLElement, RecordState>();
  private cache = new Map<string, Verdict>();
  private queue = new Map<string, Candidate>();
  private dismissed = new Set<string>();
  private assessed = new Map<string, Verdict['category']>();
  private dirty = new Set<HTMLElement>();
  private observer?: MutationObserver;
  private intersection?: IntersectionObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private batchTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private urlTimer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private active = 0;
  private disposed = false;
  private restored = false;
  private lastUrl: string;
  private cooldownUntil = 0;
  private evidenceWarning?: string;
  private stats: PageStats = { ...EMPTY_STATS };
  private readonly win: Window;

  constructor(private readonly doc: Document, private readonly bridge: RuntimeBridge) {
    if (!doc.defaultView) throw new Error('Content document has no window.');
    this.win = doc.defaultView;
    this.lastUrl = this.win.location.href;
  }

  get pageStats(): PageStats { return { ...this.stats }; }

  async start(): Promise<void> {
    try {
      const settings = await this.bridge.send({ type: 'GET_SETTINGS' });
      if (settings && typeof settings === 'object' && 'enabled' in settings) this.settings = settings as Settings;
    } catch { this.setStatus('error', 'The extension could not connect. Reload this tab to try again.'); return; }
    if (this.disposed) return;
    this.observer = new MutationObserver(mutations => {
      let changed = false;
      for (const mutation of mutations) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (target?.closest('[data-no-slop-root]')) continue;
        if (mutation.type === 'childList') {
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
          if (nodes.length && nodes.every(node => node instanceof Element && node.matches('[data-no-slop-root]'))) continue;
        }
        changed = true;
        if (target) for (const [element] of this.records) if (element === target || element.contains(target)) this.dirty.add(element);
      }
      if (changed) this.scheduleScan();
    });
    this.observer.observe(this.doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'src', 'title', 'post-title'] });
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersection = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const record = this.records.get(entry.target as HTMLElement);
          if (entry.isIntersecting && record?.state === 'waiting') this.enqueue(record);
        }
      }, { rootMargin: '400px' });
    }
    this.win.addEventListener('scroll', this.onScroll, { passive: true });
    this.win.addEventListener('popstate', this.onNavigation);
    this.win.addEventListener('hashchange', this.onNavigation);
    this.doc.addEventListener('yt-navigate-finish', this.onNavigation);
    // SPA history changes do not dispatch popstate; avoid modifying the page's history API.
    this.urlTimer = setInterval(this.onNavigation, 1000);
    this.scan();
  }

  private onScroll = () => this.scheduleScan();
  private onNavigation = () => {
    if (this.lastUrl === this.win.location.href) return;
    this.generation++;
    clearTimeout(this.retryTimer);
    this.restoreAll();
    this.records.clear();
    this.queue.clear();
    this.assessed.clear();
    this.dismissed.clear();
    this.dirty.clear();
    this.intersection?.disconnect();
    this.restored = false;
    this.cooldownUntil = 0;
    this.evidenceWarning = undefined;
    this.lastUrl = this.win.location.href;
    this.stats = { ...EMPTY_STATS };
    this.scheduleScan();
  };

  private allowed(): boolean {
    const url = new URL(this.win.location.href);
    return !this.disposed && !this.restored && this.settings.enabled && this.settings.consent &&
      !isPrivatePage(url) && !isAllowlisted(url.hostname, this.settings.allowlist) &&
      this.settings.platforms[platformForUrl(url, this.doc)] !== false;
  }

  private nearViewport(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return rect.bottom >= -500 && rect.top <= this.win.innerHeight + 500;
  }

  private scheduleScan(): void {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.scan(); }, 250);
  }

  scan(): void {
    if (this.lastUrl !== this.win.location.href) { this.onNavigation(); return; }
    if (!this.allowed()) { this.restoreAll(); this.setStatus('paused'); return; }
    if (Date.now() < this.cooldownUntil) return;
    for (const [element, record] of this.records) {
      if (!element.isConnected) {
        record.presentation?.restore();
        this.intersection?.unobserve(element);
        this.records.delete(element);
        this.dirty.delete(element);
      }
    }
    const candidates = extractCandidates(this.doc, new URL(this.lastUrl), this.settings.annotateParagraphs, 240, element =>
      this.dirty.has(element) || (this.records.get(element)?.presentation?.mode !== 'hide' && this.nearViewport(element)),
    );
    const seen = new Set(candidates.map(candidate => candidate.element));
    const dirty = new Set(this.dirty);
    for (const element of this.dirty) {
      if (!seen.has(element)) {
        this.records.get(element)?.presentation?.restore();
        this.records.delete(element);
        this.intersection?.unobserve(element);
      }
    }
    this.dirty.clear();
    for (const candidate of candidates) {
      const existing = this.records.get(candidate.element);
      if (existing?.candidate.fingerprint === candidate.fingerprint) {
        existing.candidate = candidate;
        if (dirty.has(candidate.element) && existing.verdict) this.apply(existing);
        if (existing.state === 'waiting' && this.nearViewport(candidate.element)) this.enqueue(existing);
        continue;
      }
      existing?.presentation?.restore();
      const rect = candidate.element.getBoundingClientRect();
      if (rect.height > this.win.innerHeight * 2.5) candidate.preserveContext = true;
      if (this.doc.activeElement && candidate.element.contains(this.doc.activeElement)) candidate.preserveContext = true;
      const verdict = this.cache.get(candidate.fingerprint);
      const record: RecordState = { candidate, verdict, state: verdict ? 'done' : 'waiting' };
      this.records.set(candidate.element, record);
      if (verdict) { this.assessed.set(candidate.fingerprint, verdict.category); this.apply(record); }
      else {
        this.intersection?.observe(candidate.element);
        // Already-visible cards should not wait on the observer's initial delivery.
        if (this.nearViewport(candidate.element)) this.enqueue(record);
      }
    }
    // Long feeds can run indefinitely. Restore offscreen old nodes before releasing ownership.
    if (this.records.size > 600) for (const [element, record] of this.records) {
      if (this.records.size <= 500) break;
      if (this.nearViewport(element)) continue;
      record.presentation?.restore();
      this.intersection?.unobserve(element);
      this.records.delete(element);
    }
    this.publish();
  }

  private enqueue(record: RecordState): void {
    if (record.state !== 'waiting' || !this.allowed() || this.queue.size >= 160) return;
    record.state = 'queued';
    this.queue.set(record.candidate.fingerprint, record.candidate);
    this.intersection?.unobserve(record.candidate.element);
    if (!this.batchTimer) this.batchTimer = setTimeout(() => { this.batchTimer = undefined; void this.drain(); }, 90);
  }

  private async drain(): Promise<void> {
    if (this.active || !this.allowed() || !this.queue.size || Date.now() < this.cooldownUntil) return;
    for (const [key, candidate] of this.queue) {
      const record = this.records.get(candidate.element);
      if (!candidate.element.isConnected || record?.candidate.fingerprint !== key || !this.nearViewport(candidate.element)) {
        const sameContent = [...this.records.values()].filter(other => other.candidate.fingerprint === key);
        const replacement = sameContent.find(other => other.candidate.element.isConnected && this.nearViewport(other.candidate.element));
        if (replacement) this.queue.set(key, replacement.candidate);
        else {
          this.queue.delete(key);
          for (const other of sameContent) { other.state = 'waiting'; this.intersection?.observe(other.candidate.element); }
        }
      }
    }
    if (!this.queue.size) { this.setStatus('ready'); return; }
    const batch = [...this.queue.values()].slice(0, 4);
    for (const candidate of batch) this.queue.delete(candidate.fingerprint);
    const generation = this.generation;
    const pageUrl = this.lastUrl;
    this.active++;
    this.setStatus('scanning');
    let requestTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.bridge.send({ type: 'ANALYZE', items: batch.map(candidate => candidate.item) }),
        new Promise<never>((_, reject) => { requestTimeout = setTimeout(() => reject(new Error('The detector timed out. Original content remains visible. Rescan to retry.')), 30_000); }),
      ]);
      if (this.disposed || generation !== this.generation || pageUrl !== this.win.location.href || !this.allowed()) return;
      const deferred = AnalysisDeferredSchema.safeParse(response);
      if (deferred.success) {
        this.cooldownUntil = Date.now() + deferred.data.retryAfterMs;
        for (const record of this.records.values()) if (record.state === 'queued') record.state = 'waiting';
        this.queue.clear();
        clearTimeout(this.retryTimer);
        this.setStatus('waiting');
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          if (this.disposed || generation !== this.generation || !this.allowed()) return;
          // Re-extract visible content: feeds may have recycled nodes while waiting.
          this.scan();
          if (generation !== this.generation || !this.allowed()) return;
          if (this.queue.size) void this.drain();
          else this.setStatus('ready');
        }, deferred.data.retryAfterMs + 50);
        return;
      }
      const parsed = AnalyzeResponseSchema.safeParse(response);
      if (!parsed.success) throw new Error(response && typeof response === 'object' && 'error' in response && typeof response.error === 'string' ? response.error : 'The detector returned an invalid response.');
      const verdicts = new Map(parsed.data.verdicts.map(verdict => [verdict.id, verdict]));
      if (parsed.data.errors.length) this.evidenceWarning = `Some items have incomplete evidence: ${parsed.data.errors[0].message}`.slice(0, 200);
      let failed = 0;
      for (const candidate of batch) {
        const verdict = verdicts.get(candidate.item.id);
        if (verdict) {
          this.cache.set(candidate.fingerprint, verdict);
          this.assessed.set(candidate.fingerprint, verdict.category);
        } else failed++;
        for (const record of this.records.values()) if (record.candidate.fingerprint === candidate.fingerprint) {
          record.state = verdict ? 'done' : 'error';
          record.verdict = verdict;
          if (verdict && record.candidate.element.isConnected && !this.dirty.has(record.candidate.element)) this.apply(record);
        }
      }
      while (this.cache.size > 800) this.cache.delete(this.cache.keys().next().value!);
      while (this.assessed.size > 1200) this.assessed.delete(this.assessed.keys().next().value!);
      if (failed) this.setStatus('error', `${failed} item${failed === 1 ? '' : 's'} could not be assessed. Original content remains visible. Rescan to retry.`);
      else this.setStatus(this.queue.size ? 'scanning' : 'ready');
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.cooldownUntil = Date.now() + 30_000;
      for (const record of this.records.values()) if (record.state === 'queued') record.state = 'error';
      this.queue.clear();
      this.setStatus('error', error instanceof Error ? error.message : 'Detector unavailable. Original content remains visible.');
    } finally {
      clearTimeout(requestTimeout);
      this.active--;
      if (this.queue.size && this.allowed() && Date.now() >= this.cooldownUntil) void this.drain();
      else if (generation === this.generation && this.allowed() && Date.now() >= this.cooldownUntil && [...this.records.values()].some(record => record.state === 'waiting' && this.nearViewport(record.candidate.element))) this.scheduleScan();
    }
  }

  private apply(record: RecordState): void {
    record.presentation?.restore();
    record.presentation = undefined;
    if (!record.verdict || !this.allowed() || !isEligibleContentUnit(record.candidate.element) || this.dirty.has(record.candidate.element) || !shouldFilter(record.verdict, this.settings) || this.dismissed.has(record.candidate.fingerprint)) return;
    if (record.candidate.item.kind === 'paragraph' && !this.settings.annotateParagraphs) return;
    if (this.doc.activeElement && record.candidate.element.contains(this.doc.activeElement)) record.candidate.preserveContext = true;
    const reducedMotion = this.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    record.presentation = presentCandidate(record.candidate, record.verdict, this.settings, () => {
      this.dismissed.add(record.candidate.fingerprint);
      record.presentation = undefined;
      this.publish();
    }, reducedMotion);
  }

  updateSettings(settings: Settings): void {
    clearTimeout(this.retryTimer);
    const inferenceChanged = this.settings.inspectThumbnails !== settings.inspectThumbnails || this.settings.inspectDestinations !== settings.inspectDestinations || this.settings.endpoint !== settings.endpoint || this.settings.serviceToken !== settings.serviceToken;
    this.settings = settings;
    this.generation++;
    this.queue.clear();
    this.cooldownUntil = 0;
    this.evidenceWarning = undefined;
    if (inferenceChanged) this.cache.clear();
    for (const record of this.records.values()) {
      if (inferenceChanged) record.verdict = undefined;
      record.state = record.verdict ? 'done' : 'waiting';
      this.apply(record);
      if (!record.verdict && this.allowed()) this.enqueue(record);
    }
    this.stats.error = undefined;
    this.setStatus(this.allowed() ? 'ready' : 'paused');
    this.scheduleScan();
  }

  restorePage(): void {
    clearTimeout(this.retryTimer);
    this.generation++;
    this.restored = true;
    this.queue.clear();
    this.restoreAll();
    this.setStatus('paused');
  }

  rescan(): void {
    clearTimeout(this.retryTimer);
    this.generation++;
    this.restored = false;
    this.cooldownUntil = 0;
    this.evidenceWarning = undefined;
    this.restoreAll();
    this.records.clear();
    this.queue.clear();
    this.cache.clear();
    this.assessed.clear();
    this.dismissed.clear();
    this.intersection?.disconnect();
    this.stats = { ...EMPTY_STATS };
    this.scan();
  }

  private restoreAll(): void {
    for (const record of this.records.values()) { record.presentation?.restore(); record.presentation = undefined; }
  }

  private setStatus(status: PageStats['status'], error?: string): void {
    this.stats.status = status === 'ready' && this.evidenceWarning ? 'error' : status;
    this.stats.error = (error ?? (status === 'ready' || status === 'scanning' ? this.evidenceWarning : undefined))?.slice(0, 200);
    this.publish();
  }

  private publish(): void {
    this.stats.scanned = this.assessed.size;
    this.stats.filtered = [...this.records.values()].filter(record => record.presentation).length;
    this.stats.uncertain = [...this.assessed.values()].filter(category => category === 'uncertain').length;
    void this.bridge.send({ type: 'PAGE_STATS', stats: { ...this.stats } }).catch(() => {});
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.observer?.disconnect();
    this.intersection?.disconnect();
    clearTimeout(this.timer);
    clearTimeout(this.batchTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.urlTimer);
    this.win.removeEventListener('scroll', this.onScroll);
    this.win.removeEventListener('popstate', this.onNavigation);
    this.win.removeEventListener('hashchange', this.onNavigation);
    this.doc.removeEventListener('yt-navigate-finish', this.onNavigation);
    this.restoreAll();
    this.queue.clear();
    this.records.clear();
  }
}
