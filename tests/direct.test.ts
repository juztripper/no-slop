import { describe, expect, it, vi } from 'vitest';
import { DirectDetector, DirectError, DIRECT_STORAGE_KEY, type DirectStorage } from '../src/background/direct';
import { AnalyzeRequestSchema, type ContentItem } from '../src/shared/contracts';
import { QUESTIONS, type Decision } from '../src/shared/decision';
import { Detector, type Provider } from '../server/detector';
import { readConfig } from '../server/config';

const apiKey = 'sk-or-v1-' + 'test'.repeat(16);
const config = { apiKey, dailyCallLimit: 100 };
const item: ContentItem = { id: 'private-dom-id', platform: 'x', kind: 'post', title: 'A visible title', text: 'Sensitive fixture content, not for local persistence.' };
const request = (...items: ContentItem[]) => AnalyzeRequestSchema.parse({ items, inspectDestinations: true });
const signal = () => new AbortController().signal;
const decision = (low = .94, synthetic = .1, enough = .98): Decision => ({ model: '~typesafe/jev-latest', answers: {
  low_quality: { type: 'noul', noul: low }, synthetic: { type: 'noul', noul: synthetic },
  clickbait: { type: 'noul', noul: .2 }, enough_evidence: { type: 'noul', noul: enough },
} });
class Storage implements DirectStorage {
  data: Record<string, unknown> = {};
  get = vi.fn(async (_keys: string[]) => structuredClone(this.data));
  set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(this.data, structuredClone(items)); });
  get state() { return this.data[DIRECT_STORAGE_KEY] as { used: number; cache: unknown[] }; }
}
const goodFetch = () => vi.fn<typeof fetch>().mockImplementation(async () => Response.json(decision()));

describe('direct OpenRouter boundary', () => {
  it('sends only visible text with shared questions and the fixed Jev model', async () => {
    const storage = new Storage(); const fetcher = goodFetch();
    const result = await new DirectDetector(storage, fetcher).analyze(request({ ...item, kind: 'search', url: 'https://private.example/link', thumbnailUrl: 'https://private.example/picture' }), config, signal());
    expect(result.verdicts[0]).toMatchObject({ id: item.id, category: 'human-slop', evidence: { text: true, thumbnail: false, destination: false } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]; const body = JSON.parse(options!.body as string);
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
    expect(body).toMatchObject({ model: '~typesafe/jev-latest', questions: QUESTIONS, state: { record: { title: item.title, text: item.text, destinationStatus: 'not requested' } } });
    expect(JSON.stringify(body)).not.toContain('private.example');
    expect(JSON.stringify(body)).not.toContain(item.id);
    const stored = JSON.stringify(storage.data);
    for (const secret of [apiKey, item.id, item.text, item.title, 'private.example']) expect(stored).not.toContain(secret);
    expect(storage.state.used).toBe(1);
  });

  it.each(['', ' ', 'not-a-key', 'sk-or-v1-short', apiKey + '\n'])('rejects invalid keys before storage or provider calls (%s)', async key => {
    const storage = new Storage(); const fetcher = goodFetch();
    await expect(new DirectDetector(storage, fetcher).analyze(request(item), { ...config, apiKey: key }, signal())).rejects.toMatchObject({ statusCode: 401 });
    expect(fetcher).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled();
  });

  it.each([[401, 'rejected your API key'], [402, 'credit or key spending limit'], [429, 'rate limiting']] as const)('reports safe actionable errors for HTTP %s', async (status, message) => {
    const storage = new Storage(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(apiKey + ' private provider body', { status, headers: { 'Retry-After': '45' } }));
    const pending = new DirectDetector(storage, fetcher, () => Date.parse('2026-09-20T12:00:00Z')).analyze(request(item), config, signal());
    await expect(pending).rejects.toThrow(message);
    await expect(pending).rejects.toMatchObject({ statusCode: status, ...(status === 429 ? { retryAfterMs: 46_000 } : {}) });
    await pending.catch(error => { expect(error.message).not.toContain(apiKey); expect(error.message).not.toContain('private provider body'); });
    expect(storage.state.used).toBe(1);
  });

  it('honors date Retry-After values with a bounded delay', async () => {
    const now = Date.parse('2026-09-20T12:00:00Z');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': 'Sun, 20 Sep 2026 12:00:20 GMT' } }));
    await expect(new DirectDetector(new Storage(), fetcher, () => now).analyze(request(item), config, signal())).rejects.toMatchObject({ retryAfterMs: 21_000 });
  });

  it.each(['network', 'oversize', 'schema', 'json'])('keeps content on %s failures and counts attempted calls', async kind => {
    const storage = new Storage(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (kind === 'network') throw new Error(apiKey);
      if (kind === 'oversize') return new Response('x'.repeat(64_001));
      if (kind === 'schema') return Response.json({ ...decision(), answers: {} });
      return new Response('{private provider body');
    });
    const result = await new DirectDetector(storage, fetcher).analyze(request(item), config, signal());
    expect(result.verdicts).toEqual([]); expect(result.errors).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(apiKey); expect(JSON.stringify(result)).not.toContain('private provider body');
    expect(storage.state.used).toBe(1); expect(storage.state.cache).toEqual([]);
  });
});

describe('durable daily allowance and cache', () => {
  it('reserves durably before the outbound call and deduplicates item IDs across worker restarts', async () => {
    const storage = new Storage(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      expect(storage.state.used).toBe(1); return Response.json(decision());
    });
    const first = await new DirectDetector(storage, fetcher).analyze(request(item, { ...item, id: 'another-id' }), config, signal());
    expect(first.verdicts.map(verdict => verdict.id)).toEqual([item.id, 'another-id']);
    const second = await new DirectDetector(storage, fetcher).analyze(request({ ...item, id: 'after-restart', thumbnailUrl: 'https://ignored.example' }), config, signal());
    expect(second.verdicts[0].id).toBe('after-restart'); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serializes simultaneous reservations and enforces the saved cap after restart', async () => {
    const storage = new Storage(); const fetcher = goodFetch(); const capped = { ...config, dailyCallLimit: 1 };
    const one = new DirectDetector(storage, fetcher); const two = new DirectDetector(storage, fetcher);
    await Promise.allSettled([one.analyze(request(item), capped, signal()), two.analyze(request({ ...item, text: 'Different evidence' }), capped, signal())]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(storage.state.used).toBe(1);
    await expect(new DirectDetector(storage, fetcher).analyze(request({ ...item, text: 'Third evidence' }), capped, signal())).rejects.toMatchObject({ statusCode: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('allows a higher daily cap immediately without scheduling a provider cooldown', async () => {
    const storage = new Storage(); const fetcher = goodFetch(); const detector = new DirectDetector(storage, fetcher);
    await detector.analyze(request(item), { ...config, dailyCallLimit: 1 }, signal());
    await expect(detector.analyze(request({ ...item, text: 'Second' }), { ...config, dailyCallLimit: 1 }, signal())).rejects.toMatchObject({ statusCode: 429, retryAfterMs: undefined });
    expect((await detector.analyze(request({ ...item, text: 'Second' }), { ...config, dailyCallLimit: 2 }, signal())).verdicts).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('finishes already-paid work at the allowance boundary and reports unreserved items separately', async () => {
    const storage = new Storage(); let complete!: () => void; const canceled = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((resolve, reject) => {
      complete = () => resolve(Response.json(decision()));
      options!.signal!.addEventListener('abort', () => { canceled(); reject(new Error('aborted')); }, { once: true });
    }));
    const detector = new DirectDetector(storage, fetcher); const capped = { ...config, dailyCallLimit: 1 };
    const pending = detector.analyze(request(item, { ...item, id: 'unreserved', text: 'Another item' }), capped, signal());
    void pending.catch(() => undefined);
    // Both items have reached their serialized usage check while the admitted
    // fetch remains pending. Hitting the cap must not cancel that fetch.
    await vi.waitFor(() => expect(storage.get.mock.calls.length).toBeGreaterThanOrEqual(6));
    expect(canceled).not.toHaveBeenCalled(); complete();
    const result = await pending;
    expect(result.verdicts.map(verdict => verdict.id)).toEqual([item.id]);
    expect(result.errors).toEqual([{ id: 'unreserved', message: expect.stringContaining('allowance reached') }]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(storage.state.used).toBe(1);

    const cached = await detector.analyze(request({ ...item, id: 'cached' }, { ...item, id: 'unreserved-again', text: 'Third item' }), capped, signal());
    expect(cached.verdicts.map(verdict => verdict.id)).toEqual(['cached']);
    expect(cached.errors[0]).toMatchObject({ id: 'unreserved-again', message: expect.stringContaining('allowance reached') });

    await expect(detector.analyze(request({ ...item, text: 'Fourth item' }), capped, signal())).rejects.toMatchObject({ code: 'daily-allowance', statusCode: 429, retryAfterMs: undefined });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(canceled).not.toHaveBeenCalled();
  });

  it('persists provider cooldowns across workers while allowing a replaced API key', async () => {
    let now = Date.parse('2026-09-20T12:00:00Z'); const storage = new Storage();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '23' } })).mockImplementation(async () => Response.json(decision()));
    await expect(new DirectDetector(storage, fetcher, () => now).analyze(request(item), config, signal())).rejects.toMatchObject({ retryAfterMs: 24_000 });
    await expect(new DirectDetector(storage, fetcher, () => now).analyze(request(item), config, signal())).rejects.toMatchObject({ retryAfterMs: 24_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await new DirectDetector(storage, fetcher, () => now).analyze(request({ ...item, text: 'New key request' }), { ...config, apiKey: 'sk-or-v1-' + 'other'.repeat(12) }, signal());
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 24_001;
    await new DirectDetector(storage, fetcher, () => now).analyze(request(item), config, signal());
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('preserves the longest cooldown when concurrent provider responses disagree', async () => {
    const now = Date.parse('2026-09-20T12:00:00Z'); const storage = new Storage(); const finish: Array<(response: Response) => void> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    const pending = new DirectDetector(storage, fetcher, () => now).analyze(request(item, { ...item, id: 'second', text: 'Different content' }), config, signal());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    finish[0](new Response('', { status: 429, headers: { 'Retry-After': '300' } }));
    finish[1](new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
    await expect(pending).rejects.toMatchObject({ statusCode: 429, retryAfterMs: 301_000 });
    const nextFetch = goodFetch();
    await expect(new DirectDetector(storage, nextFetch, () => now).analyze(request(item), config, signal())).rejects.toMatchObject({ retryAfterMs: 301_000 });
    expect(nextFetch).not.toHaveBeenCalled();
    expect(storage.data[DIRECT_STORAGE_KEY]).toMatchObject({ cooldown: { until: now + 301_000 } });
  });

  it('rolls the ledger at UTC midnight and expires cached decisions', async () => {
    let now = Date.parse('2026-09-20T23:59:00Z'); const storage = new Storage(); const fetcher = goodFetch(); const detector = new DirectDetector(storage, fetcher, () => now);
    await detector.analyze(request(item), { ...config, dailyCallLimit: 1 }, signal());
    now += 16 * 60_000;
    await detector.analyze(request(item), { ...config, dailyCallLimit: 1 }, signal());
    expect(fetcher).toHaveBeenCalledTimes(2); expect(storage.state.used).toBe(1);
  });

  it('does not call the provider when usage cannot be read or persisted', async () => {
    for (const failure of ['get', 'set', 'corrupt'] as const) {
      const storage = new Storage(); const fetcher = goodFetch();
      if (failure === 'get') storage.get.mockRejectedValue(new Error('private storage details'));
      if (failure === 'set') storage.set.mockRejectedValue(new Error('private storage details'));
      if (failure === 'corrupt') storage.data[DIRECT_STORAGE_KEY] = { used: 'oops' };
      const result = await new DirectDetector(storage, fetcher).analyze(request(item), config, signal());
      expect(result.verdicts).toEqual([]); expect(result.errors).toHaveLength(1); expect(fetcher).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('private storage details');
    }
  });

  it('bounds the persistent cache and excludes expired entries', async () => {
    const now = Date.parse('2026-09-20T12:00:00Z'); const storage = new Storage(); const fetcher = goodFetch();
    storage.data[DIRECT_STORAGE_KEY] = { version: 1, day: '2026-09-20', used: 0, cache: Array.from({ length: 150 }, (_, i) => ({ hash: i.toString(16).padStart(64, '0'), expires: now + 100_000, decision: decision() })) };
    await new DirectDetector(storage, fetcher, () => now).analyze(request(item), config, signal());
    expect(storage.state.cache).toHaveLength(128);
  });
});

describe('cancellation and resource limits', () => {
  it('does not reserve or spend for a pre-canceled request', async () => {
    const controller = new AbortController(); controller.abort(); const storage = new Storage(); const fetcher = goodFetch();
    await expect(new DirectDetector(storage, fetcher).analyze(request(item), config, controller.signal)).rejects.toBeInstanceOf(DirectError);
    expect(fetcher).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled();
  });

  it('cancels queued items without spending and caps active work at two', async () => {
    const storage = new Storage(); const controller = new AbortController(); let active = 0; let peak = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      active++; peak = Math.max(peak, active);
      options!.signal!.addEventListener('abort', () => { active--; reject(new Error('aborted')); }, { once: true });
    }));
    const pending = new DirectDetector(storage, fetcher).analyze(request(...Array.from({ length: 8 }, (_, i) => ({ ...item, id: String(i), text: `Different ${i}` }))), config, controller.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    controller.abort(); await expect(pending).rejects.toThrow('interrupted');
    expect(peak).toBe(2); expect(storage.state.used).toBe(2); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rolls back an unspent reservation if cancellation occurs during persistence', async () => {
    const storage = new Storage(); const controller = new AbortController(); const fetcher = goodFetch(); const set = storage.set;
    storage.set = vi.fn(async data => { await set(data); if (storage.state.used === 1) controller.abort(); });
    await expect(new DirectDetector(storage, fetcher).analyze(request(item), config, controller.signal)).rejects.toThrow('interrupted');
    await vi.waitFor(() => expect(storage.state.used).toBe(0));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops queued work after provider rejection rather than repeating rejected paid calls', async () => {
    const storage = new Storage();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 401 }));
    const detector = new DirectDetector(storage, fetcher);
    await expect(detector.analyze(request(...Array.from({ length: 8 }, (_, i) => ({ ...item, id: String(i), text: `Unique item ${i}` }))), config, signal())).rejects.toMatchObject({ statusCode: 401 });
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
    const calls = fetcher.mock.calls.length;
    await expect(detector.analyze(request({ ...item, text: 'Another batch' }), config, signal())).rejects.toMatchObject({ statusCode: 401 });
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });

  it('does not let cancellation of one subscriber cancel another caller sharing evidence', async () => {
    const storage = new Storage(); const one = new AbortController(); let finish!: () => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = () => resolve(Response.json(decision())); }));
    const detector = new DirectDetector(storage, fetcher);
    const first = detector.analyze(request(item), config, one.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const second = detector.analyze(request({ ...item, id: 'survivor' }), config, signal());
    await vi.waitFor(() => expect(storage.get.mock.calls.length).toBeGreaterThanOrEqual(4));
    one.abort(); await expect(first).rejects.toThrow('interrupted'); finish();
    expect((await second).verdicts[0].id).toBe('survivor'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('server and extension policy parity', () => {
  it.each([[.94, .95, .98], [.94, .1, .98], [.94, .6, .98], [.94, .1, .3], [.1, .95, .98]])('returns the same verdict for %s/%s/%s', async (low, synthetic, enough) => {
    const result = decision(low, synthetic, enough);
    const provider: Provider = { decide: vi.fn().mockResolvedValue(result), describeImage: vi.fn() };
    const server = new Detector(readConfig({ BUDGET_FILE: '' }), provider);
    const direct = new DirectDetector(new Storage(), vi.fn<typeof fetch>().mockResolvedValue(Response.json(result)));
    expect(await direct.analyze(request(item), config, signal())).toEqual(await server.analyze([item], { inspectDestinations: false, inspectThumbnails: false }));
  });
});
