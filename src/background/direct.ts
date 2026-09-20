import { z } from 'zod';
import { AnalyzeRequestSchema, type AnalyzeResponse, type ContentItem } from '../shared/contracts';
import { DecisionSchema, POLICY_VERSION, QUESTIONS, verdictFromDecision, type Decision } from '../shared/decision';
import { retryDelay } from './pacing';

export const DIRECT_MODEL = '~typesafe/jev-latest';
export const DIRECT_STORAGE_KEY = 'noSlopDirectStateV1';
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_ENTRIES = 128;
const OPERATION_TIMEOUT_MS = 20_000;
const CONCURRENCY = 2;
const QUEUED_ITEMS = 14;

/** Only the trusted extension worker should receive this storage area. */
export interface DirectStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
export class DirectError extends Error {
  constructor(public readonly publicMessage: string, public readonly statusCode = 503, public readonly retryAfterMs?: number, public readonly code?: 'daily-allowance') {
    super(publicMessage); this.name = 'DirectError';
  }
}
export function isValidOpenRouterKey(value: string): boolean {
  return value.length <= 500 && /^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(value);
}
const interrupted = () => new DirectError('Analysis interrupted. Content stays visible.');
function checkSignal(signal: AbortSignal): void { if (signal.aborted) throw interrupted(); }

// A worker has one storage object. Sharing its lock also makes concurrent detector
// instances safe; every transaction reloads the persisted ledger before changing it.
const storageLocks = new WeakMap<DirectStorage, Promise<unknown>>();
function transaction<T>(storage: DirectStorage, operation: () => Promise<T>): Promise<T> {
  const result = (storageLocks.get(storage) ?? Promise.resolve()).then(operation);
  storageLocks.set(storage, result.catch(() => undefined));
  return result;
}
type CacheEntry = { hash: string; expires: number; decision: Decision };
type Cooldown = { keyHash: string; until: number; status: 401 | 402 | 429 };
type DirectConfig = { apiKey: string; dailyCallLimit: number; keyHash: string };
type State = { version: 1; day: string; used: number; cache: CacheEntry[]; cooldown?: Cooldown };
function mergeCooldown(incoming: Cooldown, existing?: Cooldown): Cooldown {
  return existing?.keyHash === incoming.keyHash && existing.until > incoming.until ? { ...incoming, until: existing.until } : incoming;
}
const LedgerSchema = z.object({ version: z.literal(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), used: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });
const CacheEntrySchema = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), expires: z.number().finite(), decision: DecisionSchema });
const CooldownSchema = z.object({ keyHash: z.string().regex(/^[a-f0-9]{64}$/), until: z.number().finite(), status: z.union([z.literal(401), z.literal(402), z.literal(429)]) });
async function hashValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

class Gate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  async run<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    checkSignal(signal);
    if (this.active >= CONCURRENCY) {
      if (this.waiting.length >= QUEUED_ITEMS) throw new DirectError('OpenRouter analysis is busy. Content stays visible.', 429, 2_000);
      await new Promise<void>((resolve, reject) => {
        const ready = () => { signal.removeEventListener('abort', abort); resolve(); };
        const abort = () => {
          const position = this.waiting.indexOf(ready);
          if (position !== -1) this.waiting.splice(position, 1);
          reject(interrupted());
        };
        this.waiting.push(ready); signal.addEventListener('abort', abort, { once: true });
      });
    } else this.active++;
    try { checkSignal(signal); return await operation(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
}
type Pending = { controller: AbortController; subscribers: Set<symbol>; promise: Promise<Decision> };

/** Text-only BYOK detector. No destination, image, or content-supplied URL is fetched. */
export class DirectDetector {
  private readonly gate = new Gate();
  private readonly pending = new Map<string, Pending>();
  private cooldown?: Cooldown;
  constructor(private readonly storage: DirectStorage, private readonly fetcher: typeof fetch = fetch, private readonly now = Date.now) {}

  async analyze(request: z.infer<typeof AnalyzeRequestSchema>, config: { apiKey: string; dailyCallLimit: number }, signal: AbortSignal): Promise<AnalyzeResponse> {
    checkSignal(signal);
    if (!isValidOpenRouterKey(config.apiKey)) throw new DirectError('Add a valid OpenRouter API key in NO SLOP settings.', 401);
    if (!Number.isSafeInteger(config.dailyCallLimit) || config.dailyCallLimit < 1 || config.dailyCallLimit > 10_000) throw new DirectError('Choose a valid daily call allowance in settings.');
    const resolved = { ...config, keyHash: await hashValue(config.apiKey) };
    const batch = new AbortController();
    const combined = AbortSignal.any([signal, batch.signal]);
    let failure: DirectError | undefined;
    let allowanceFailure: DirectError | undefined;
    const results = await Promise.all(request.items.map(async item => {
      try {
        const decision = await this.inspect(item, resolved, combined);
        checkSignal(combined);
        return { verdict: verdictFromDecision(item, decision, { text: Boolean(item.title.trim() || item.text.trim()), thumbnail: false, destination: false }) };
      } catch (error) {
        const safe = error instanceof DirectError ? error : new DirectError('This item could not be inspected. Content stays visible.');
        // A local allowance blocks only unreserved work. Preserve decisions from
        // calls already paid for, and cached results that need no additional call.
        if (safe.code === 'daily-allowance') allowanceFailure ??= safe;
        else if ([401, 402, 429].includes(safe.statusCode) && !failure) { failure = safe; batch.abort(); }
        return { error: { id: item.id, message: safe.publicMessage } };
      }
    }));
    checkSignal(signal);
    if (failure) throw failure;
    const verdicts = results.flatMap(result => result.verdict ? [result.verdict] : []);
    if (!verdicts.length && allowanceFailure) throw allowanceFailure;
    return { verdicts, errors: results.flatMap(result => result.error ? [result.error] : []) };
  }

  private async readState(): Promise<State> {
    let saved: unknown;
    try { saved = (await this.storage.get([DIRECT_STORAGE_KEY]))[DIRECT_STORAGE_KEY]; }
    catch { throw new DirectError('Cannot read the daily call allowance. Content stays visible.'); }
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (saved === undefined) return { version: 1, day: today, used: 0, cache: [] };
    const ledger = LedgerSchema.safeParse(saved);
    // Fail closed on unreadable usage history; silently resetting would bypass a cap.
    if (!ledger.success) throw new DirectError('The saved daily call allowance is invalid. Content stays visible.');
    const cacheValue = (saved as Record<string, unknown>).cache;
    const cache = (Array.isArray(cacheValue) ? cacheValue.slice(-CACHE_ENTRIES) : []).flatMap(entry => {
      const parsed = CacheEntrySchema.safeParse(entry);
      return parsed.success && parsed.data.expires > this.now() && parsed.data.expires <= this.now() + CACHE_TTL_MS ? [parsed.data] : [];
    });
    const cooldown = CooldownSchema.safeParse((saved as Record<string, unknown>).cooldown);
    return { ...ledger.data, ...(ledger.data.day !== today ? { day: today, used: 0 } : {}), cache,
      ...(cooldown.success && cooldown.data.until > this.now() && cooldown.data.until <= this.now() + 3_600_000 ? { cooldown: cooldown.data } : {}),
    };
  }
  private async writeState(state: State): Promise<void> {
    try { await this.storage.set({ [DIRECT_STORAGE_KEY]: state }); }
    catch { throw new DirectError('Cannot save the daily call allowance. Content stays visible.'); }
  }
  private cached(hash: string, signal: AbortSignal): Promise<Decision | undefined> {
    return transaction(this.storage, async () => {
      checkSignal(signal);
      const state = await this.readState(); checkSignal(signal);
      return state.cache.find(entry => entry.hash === hash)?.decision;
    });
  }
  private async inspect(item: ContentItem, config: DirectConfig, signal: AbortSignal): Promise<Decision> {
    // Keep the input identical to server text-only analysis. Exclude IDs and URLs
    // from both the request and hash: they neither inform the policy nor belong in storage.
    const record = { platform: item.platform, kind: item.kind, title: item.title, text: item.text, context: item.context || '', destinationStatus: 'not requested' };
    const hash = await hashValue(JSON.stringify({ record, policy: POLICY_VERSION, model: DIRECT_MODEL }));
    const cached = await this.cached(hash, signal);
    if (cached) return cached;
    checkSignal(signal);
    const pendingKey = `${config.keyHash}:${hash}`;
    let pending = this.pending.get(pendingKey);
    if (!pending || pending.controller.signal.aborted) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OPERATION_TIMEOUT_MS);
      const work: Pending = { controller, subscribers: new Set(), promise: undefined! };
      work.promise = this.gate.run(async () => {
        const secondLook = await this.cached(hash, controller.signal);
        if (secondLook) return secondLook;
        const decision = await this.decide(record, config, controller.signal);
        await transaction(this.storage, async () => {
          checkSignal(controller.signal);
          const state = await this.readState(); checkSignal(controller.signal);
          state.cache = [...state.cache.filter(entry => entry.hash !== hash), { hash, expires: this.now() + CACHE_TTL_MS, decision }].slice(-CACHE_ENTRIES);
          await this.writeState(state);
        });
        return decision;
      }, controller.signal).finally(() => {
        clearTimeout(timer);
        if (this.pending.get(pendingKey) === work) this.pending.delete(pendingKey);
      });
      pending = work; this.pending.set(pendingKey, work);
    }
    return this.subscribe(pending, signal);
  }
  private subscribe(pending: Pending, signal: AbortSignal): Promise<Decision> {
    return new Promise((resolve, reject) => {
      const token = Symbol(); pending.subscribers.add(token);
      const done = () => { signal.removeEventListener('abort', abort); pending.subscribers.delete(token); };
      const abort = () => { done(); if (!pending.subscribers.size) pending.controller.abort(); reject(interrupted()); };
      signal.addEventListener('abort', abort, { once: true });
      pending.promise.then(value => { done(); resolve(value); }, error => { done(); reject(error); });
      if (signal.aborted) abort();
    });
  }
  private async decide(record: unknown, config: DirectConfig, signal: AbortSignal): Promise<Decision> {
    // Start fetch inside the serialized reservation transaction, but do not hold
    // its lock for the network response. A reservation is durable before any cost.
    const { response } = await transaction(this.storage, async () => {
      checkSignal(signal);
      const state = await this.readState(); checkSignal(signal);
      for (const cooldown of [this.cooldown, state.cooldown]) {
        if (cooldown?.keyHash === config.keyHash && cooldown.until > this.now()) throw this.providerError(cooldown.status, cooldown.until - this.now());
      }
      if (state.used >= config.dailyCallLimit) throw new DirectError('Daily OpenRouter call allowance reached. Increase it in settings or try tomorrow.', 429, undefined, 'daily-allowance');
      state.used++; await this.writeState(state);
      if (signal.aborted) {
        // No call was attempted. The serialized rollback cannot undo another call.
        state.used--; await this.writeState(state); throw interrupted();
      }
      let response: Promise<Response>;
      try {
        response = this.fetcher('https://openrouter.ai/api/alpha/decisions', {
          method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'NO SLOP' },
          body: JSON.stringify({ model: DIRECT_MODEL, state: { record }, questions: QUESTIONS }),
          signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        });
      } catch { throw new DirectError('OpenRouter could not be reached. Content stays visible.'); }
      // Install a rejection handler immediately while the transaction releases.
      const guarded = response.catch(() => { throw new DirectError('OpenRouter could not be reached. Content stays visible.'); });
      void guarded.catch(() => undefined);
      return { response: guarded };
    });
    const result = await response;
    checkSignal(signal);
    if (!result.ok) {
      await result.body?.cancel().catch(() => undefined);
      if ([401, 402, 403, 429].includes(result.status)) {
        const status = result.status === 403 ? 401 : result.status as 401 | 402 | 429;
        const delay = status === 429 ? retryDelay(result.headers.get('Retry-After'), this.now()) : 60_000;
        let cooldown: Cooldown = mergeCooldown({ keyHash: config.keyHash, until: this.now() + delay, status }, this.cooldown);
        this.cooldown = cooldown;
        // Persist before releasing the work slot, so queued batches and a restarted
        // worker cannot keep charging against a rate-limited or rejected key.
        await transaction(this.storage, async () => {
          const state = await this.readState();
          cooldown = mergeCooldown(mergeCooldown(cooldown, state.cooldown), this.cooldown);
          this.cooldown = cooldown; state.cooldown = cooldown; await this.writeState(state);
        });
        throw this.providerError(status, cooldown.until - this.now());
      }
      throw new DirectError('OpenRouter is unavailable. Content stays visible.');
    }
    const parsed = DecisionSchema.safeParse(await this.readResponse(result, signal));
    if (!parsed.success) throw new DirectError('OpenRouter returned invalid decisions. Content stays visible.');
    return { model: parsed.data.model, answers: parsed.data.answers };
  }
  private providerError(status: 401 | 402 | 429, delay: number): DirectError {
    if (status === 401) return new DirectError('OpenRouter rejected your API key. Check it in NO SLOP settings.', 401);
    if (status === 402) return new DirectError('Your OpenRouter credit or key spending limit is exhausted. Content stays visible.', 402);
    return new DirectError('OpenRouter is rate limiting requests. Content stays visible.', 429, Math.min(3_600_000, Math.max(1_000, delay)));
  }
  private async readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new DirectError('OpenRouter returned an empty response. Content stays visible.');
    const abort = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener('abort', abort, { once: true });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        checkSignal(signal);
        const { done, value } = await reader.read();
        checkSignal(signal);
        if (done) break;
        size += value.byteLength;
        if (size > 64_000) { await reader.cancel(); throw new DirectError('OpenRouter response exceeded the limit. Content stays visible.'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch (error) {
      if (error instanceof DirectError) throw error;
      throw new DirectError('OpenRouter returned an invalid response. Content stays visible.');
    } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  }
}
