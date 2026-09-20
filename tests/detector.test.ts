import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../server/config';
import { Detector, verdictFromDecision, type Provider } from '../server/detector';
import { DailyBudget, ExpiringCache, WorkGate } from '../server/limits';
import { OpenRouterProvider, type Decision } from '../server/provider';
import type { ContentItem } from '../src/shared/contracts';

const item: ContentItem = { id: 'one', platform: 'forum', kind: 'post', title: 'An example', text: 'Some content to analyze.' };
const evidence = { text: true, thumbnail: false, destination: false };
const config = () => readConfig({ OPENROUTER_API_KEY: 'test-key', BUDGET_FILE: '' });
function decision(low = 0.99, synthetic = 0.01, enough = 0.99): Decision {
  return { model: 'test-jev', answers: { low_quality: { type: 'noul', noul: low }, synthetic: { type: 'noul', noul: synthetic }, clickbait: { type: 'noul', noul: 0.2 }, enough_evidence: { type: 'noul', noul: enough } } };
}
function provider(result = decision()): Provider {
  return { decide: vi.fn().mockResolvedValue(result), describeImage: vi.fn().mockResolvedValue({ description: 'A bicycle', visibleText: '', artifacts: [], syntheticEvidence: 'none' }) };
}
describe('conservative decision policy', () => {
  it('never filters helpful AI-assisted content for AI use alone', () => {
    const verdict = verdictFromDecision(item, decision(0.03, 0.99), evidence);
    expect(verdict.category).toBe('quality');
  });
  it('requires poor quality and specific synthetic evidence for AI slop', () => {
    expect(verdictFromDecision(item, decision(0.99, 0.98), evidence)).toMatchObject({ category: 'ai-slop', confidence: 0.99 });
    expect(verdictFromDecision(item, decision(0.99, 0.6), evidence).category).toBe('slop');
  });
  it('keeps context-poor content despite a high poor-quality score', () => {
    expect(verdictFromDecision(item, decision(0.99, 0.01, 0.4), evidence).category).toBe('uncertain');
  });
  it('does not subtract authorship scores from the direct quality score', () => {
    expect(verdictFromDecision(item, decision(0.95, 0.95, 0.95), evidence).confidence).toBe(0.95);
  });
});
describe('detector orchestration', () => {
  it('deduplicates in-flight evidence while preserving caller item IDs', async () => {
    const model = provider(); const detector = new Detector(config(), model);
    const result = await detector.analyze([item, { ...item, id: 'two' }], { inspectThumbnails: false, inspectDestinations: false });
    expect(model.decide).toHaveBeenCalledTimes(1);
    expect(result.verdicts.map(verdict => verdict.id)).toEqual(['one', 'two']);
    await detector.analyze([{ ...item, id: 'three' }], { inspectThumbnails: false, inspectDestinations: false });
    expect(model.decide).toHaveBeenCalledTimes(1);
  });
  it('isolates failed items and does not invent verdicts', async () => {
    const model = provider(); vi.mocked(model.decide).mockRejectedValueOnce(new Error('secret upstream stack'));
    const result = await new Detector(config(), model).analyze([item, { ...item, id: 'two', text: 'Different content' }], { inspectThumbnails: false, inspectDestinations: false });
    expect(result.verdicts).toHaveLength(1); expect(result.errors).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('secret upstream stack');
  });
  it('ignores images even if an older extension still requests them', async () => {
    const model = provider(); const download = vi.fn().mockRejectedValue(new Error('unavailable'));
    const result = await new Detector(config(), model, download).analyze([{ ...item, thumbnailUrl: 'https://i.ytimg.com/vi/example/hqdefault.jpg' }], { inspectThumbnails: true, inspectDestinations: false });
    expect(result.verdicts[0]).toMatchObject({ category: 'human-slop', confidence:0.99, evidence:{thumbnail:false} });
    expect(result.errors).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
    expect(model.describeImage).not.toHaveBeenCalled();
    expect(vi.mocked(model.decide).mock.calls[0][0]).not.toHaveProperty('thumbnail');
  });
  it('does not repeat text analysis when only an ignored thumbnail changes', async () => {
    const model = provider(); const detector = new Detector(config(),model);
    await detector.analyze([{...item,thumbnailUrl:'https://i.ytimg.com/a.jpg'}],{inspectThumbnails:true,inspectDestinations:false});
    await detector.analyze([{...item,thumbnailUrl:'https://i.ytimg.com/b.jpg'}],{inspectThumbnails:false,inspectDestinations:false});
    expect(model.decide).toHaveBeenCalledTimes(1);
  });
  it('can use independently sufficient search text when optional destination retrieval fails', async () => {
    const model = provider();
    const result = await new Detector(config(),model,vi.fn().mockRejectedValue(new Error('unavailable'))).analyze([{...item,kind:'search',url:'https://example.com'}],{inspectThumbnails:false,inspectDestinations:true});
    expect(result.verdicts[0]).toMatchObject({category:'human-slop',evidence:{destination:false}});
    expect(result.errors).toHaveLength(1);
    expect(model.decide).toHaveBeenCalledWith(expect.objectContaining({destinationStatus:'unavailable; judge only the supplied text'}),expect.any(AbortSignal));
  });
  it('still abstains when missing destination content leaves too little evidence', async () => {
    const model = provider(decision(.97,.1,.3));
    const result = await new Detector(config(),model,vi.fn().mockRejectedValue(new Error('unavailable'))).analyze([{...item,kind:'search',url:'https://example.com'}],{inspectThumbnails:false,inspectDestinations:true});
    expect(result.verdicts[0]).toMatchObject({category:'uncertain',confidence:0});
  });
  it('does not fetch arbitrary social permalinks as search destinations', async () => {
    const download = vi.fn();
    await new Detector(config(), provider(), download).analyze([{ ...item, url: 'https://example.com/post' }], { inspectThumbnails: false, inspectDestinations: true });
    expect(download).not.toHaveBeenCalled();
  });
  it('ignores unsupported image hosts without generating missing-image warnings', async () => {
    const download = vi.fn();
    const result = await new Detector(config(), provider(), download).analyze([{ ...item, thumbnailUrl: 'https://attacker.example/image.jpg' }], { inspectThumbnails: true, inspectDestinations: false });
    expect(download).not.toHaveBeenCalled(); expect(result.errors).toHaveLength(0); expect(result.verdicts[0].evidence.thumbnail).toBe(false);
  });
});
describe('OpenRouter boundary', () => {
  it('uses the Decisions endpoint, typed noul questions and configured model', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(decision()));
    await new OpenRouterProvider(config(), new DailyBudget(10), fetcher).decide({ text: 'record' });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('~typesafe/jev-latest');
    expect(body.questions.low_quality).toMatchObject({ type: 'noul', criteria: { true: expect.any(String), false: expect.any(String) } });
  });
  it('rejects malformed or missing probabilities', async () => {
    const bad = decision(); bad.answers.low_quality.noul = 2;
    const model = new OpenRouterProvider(config(), new DailyBudget(10), vi.fn().mockResolvedValue(Response.json(bad)));
    await expect(model.decide({})).rejects.toThrow('invalid decisions');
  });
  it('does not expose provider response bodies or secrets on error', async () => {
    const model = new OpenRouterProvider(config(), new DailyBudget(10), vi.fn().mockResolvedValue(new Response('secret-user-content', { status: 500 })));
    await expect(model.decide({})).rejects.toThrow('provider returned an error (500)');
  });
  it('rejects a malformed vision result', async () => {
    const model = new OpenRouterProvider(config(), new DailyBudget(10), vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"description": "no other fields"}' } }] })));
    await expect(model.describeImage({ bytes: Buffer.from('x'), contentType: 'image/jpeg', url: 'https://i.ytimg.com/x.jpg' })).rejects.toThrow('invalid evidence');
  });
  it('propagates cancellation to paid requests and does not start a canceled call', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation(async (_url, options: RequestInit) => new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
    const model = new OpenRouterProvider(config(), new DailyBudget(10), fetcher);
    const pending = model.decide({}, controller.signal); controller.abort();
    await expect(pending).rejects.toThrow('could not be reached');
    await expect(model.decide({}, controller.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe('bounded resources', () => {
  it('preserves usage reservations across restarts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'no-slop-budget-'));
    try {
      const file = join(directory, 'budget.json');
      new DailyBudget(1, file).reserve();
      expect(() => new DailyBudget(1, file).reserve()).toThrow('daily allowance');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('charges before provider calls and rolls daily at UTC', () => {
    let now = new Date('2026-09-19T12:00:00Z'); const budget = new DailyBudget(1, '', () => now);
    budget.reserve(); expect(() => budget.reserve()).toThrow('daily allowance');
    now = new Date('2026-09-20T00:00:00Z'); expect(() => budget.reserve()).not.toThrow();
  });
  it('limits active work and rejects an overfull queue', async () => {
    const gate = new WorkGate(1, 1); let release!: () => void;
    const one = gate.run(() => new Promise<void>(resolve => { release = resolve; }));
    const two = gate.run(async () => 'two');
    await expect(gate.run(async () => 'three')).rejects.toThrow('busy');
    release(); await one; await expect(two).resolves.toBe('two');
  });
  it('removes canceled queue entries so stale work cannot start later', async () => {
    const gate = new WorkGate(1, 1); let release!: () => void;
    const active = gate.run(() => new Promise<void>(resolve => { release = resolve; }));
    const stale = vi.fn().mockResolvedValue('should not run'); const controller = new AbortController();
    const waiting = gate.run(stale, controller.signal); controller.abort();
    await expect(waiting).rejects.toThrow('timed out while waiting');
    const next = gate.run(async () => 'fresh'); release(); await active;
    await expect(next).resolves.toBe('fresh'); expect(stale).not.toHaveBeenCalled();
  });
  it('bounds cache size and returns copies', () => {
    const cache = new ExpiringCache<{ value: number }>(1, 5000);
    cache.set('a', { value: 1 }); const entry = cache.get('a')!; entry.value = 9;
    expect(cache.get('a')!.value).toBe(1); cache.set('b', { value: 2 }); expect(cache.get('a')).toBeUndefined();
  });
});
