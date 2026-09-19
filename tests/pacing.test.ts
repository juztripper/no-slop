import { describe, expect, it } from 'vitest';
import { RequestPacer, retryDelay } from '../src/background/pacing';

function setup() {
  let now = 100_000;
  const values: Record<string, unknown> = {};
  const storage = {
    get: async (key: string) => ({ [key]:values[key] }),
    set: async (data: Record<string, unknown>) => { Object.assign(values, data); },
  } as Pick<typeof chrome.storage.session, 'get' | 'set'>;
  return { storage, clock: () => now, advance: (ms:number) => { now += ms; } };
}

describe('shared request pacing', () => {
  it('keeps a sustained burst below the default 40 requests per minute', async () => {
    const state = setup();
    const pacer = new RequestPacer(state.storage, state.clock);
    let sent = 0;
    for (let time = 0; time < 60_000; time += 100) {
      const delays = await Promise.all([1,2,3,4].map(() => pacer.reserve('https://detector.example')));
      sent += delays.filter(delay=>delay === 0).length;
      state.advance(100);
    }
    expect(sent).toBe(30);
  });
  it('remembers reservations and server backoff after a worker restart', async () => {
    const state = setup();
    const first = new RequestPacer(state.storage, state.clock);
    expect(await first.reserve('https://detector.example')).toBe(0);
    const restarted = new RequestPacer(state.storage, state.clock);
    expect(await restarted.reserve('https://detector.example')).toBe(2000);
    await first.defer('https://detector.example', 61_000);
    state.advance(60_000);
    expect(await restarted.reserve('https://detector.example')).toBe(1000);
    state.advance(1000);
    expect(await restarted.reserve('https://detector.example')).toBe(0);
  });
  it('understands seconds and HTTP dates and bounds malformed server values', () => {
    expect(retryDelay('23')).toBe(24_000);
    expect(retryDelay(null)).toBe(61_000);
    expect(retryDelay('invalid')).toBe(61_000);
    expect(retryDelay('-1')).toBe(61_000);
    expect(retryDelay('0')).toBe(1000);
    expect(retryDelay('999999999')).toBe(3_600_000);
    const now = Date.parse('2026-09-19T22:00:00Z');
    expect(retryDelay('Sat, 19 Sep 2026 22:00:30 GMT', now)).toBe(31_000);
  });
});
