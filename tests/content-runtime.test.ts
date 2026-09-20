// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type RuntimeMessage, type Verdict } from '../src/shared/contracts';

const original = '<ytd-video-renderer><a id="video-title" href="/watch?v=abcdefghijk">Guaranteed money with absolutely no work</a><div>Repeated unsupported claims.</div><button>More</button></ytd-video-renderer>';
const verdict = (id: string): Verdict => ({ id, category: 'slop', confidence: .99, reasons: ['Unsupported promises.'], signals: {lowQuality:.99,synthetic:.5,clickbait:.99}, evidence: {text:true,thumbnail:false,destination:false}, model:'test' });

function makeRuntime() {
  return {
    id: 'test-extension' as string | undefined,
    sendMessage: vi.fn((message: RuntimeMessage): Promise<unknown> => {
      if (message.type === 'GET_SETTINGS') return Promise.resolve({ ...DEFAULT_SETTINGS, consent: true, animations: false });
      if (message.type === 'ANALYZE') return Promise.resolve({ verdicts: message.items.map(item => verdict(item.id)), errors: [] });
      return Promise.resolve({ ok: true });
    }),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  };
}
let runtime: ReturnType<typeof makeRuntime>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  history.replaceState({}, '', '/');
  document.body.innerHTML = original;
  runtime = makeRuntime();
  vi.stubGlobal('chrome', { runtime });
});
afterEach(() => {
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function start() {
  await import('../src/content/index');
  await vi.advanceTimersByTimeAsync(100);
  expect(document.querySelector('[data-no-slop-root]')).not.toBeNull();
}

async function expectStopped() {
  expect(document.body.innerHTML).toBe(original);
  expect(runtime.onMessage.removeListener).toHaveBeenCalledOnce();
  const calls = runtime.sendMessage.mock.calls.length;
  window.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  history.pushState({}, '', '/results?search_query=another');
  document.body.insertAdjacentHTML('beforeend', '<p>A page mutation after extension reload.</p>');
  const staleListener = runtime.onMessage.addListener.mock.calls[0]?.[0];
  const respond = vi.fn();
  staleListener?.({ type:'RESCAN_PAGE' }, {}, respond);
  await vi.advanceTimersByTimeAsync(35_000);
  expect(runtime.sendMessage).toHaveBeenCalledTimes(calls);
  expect(respond).not.toHaveBeenCalled();
  expect(document.querySelector('[data-no-slop-root]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
}

describe('extension reload lifecycle using the actual entry and controller', () => {
  it('retires a disconnected scanner even when its tab stays quiet', async () => {
    await start();
    runtime.id = undefined;
    await vi.advanceTimersByTimeAsync(1000);
    await expectStopped();
  });

  it.each(['throw', 'reject'] as const)('handles a runtime %s during status reporting and restores the page', async failure => {
    await start();
    runtime.sendMessage.mockImplementation(() => {
      const error = new Error('Extension context invalidated.');
      if (failure === 'throw') throw error;
      return Promise.reject(error);
    });
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(300);
    await expectStopped();
  });

  it.each(['throw', 'reject'] as const)('handles a runtime %s during startup without recursive status errors', async failure => {
    runtime.sendMessage.mockImplementation(() => {
      const error = new Error('Extension context invalidated.');
      if (failure === 'throw') throw error;
      return Promise.reject(error);
    });
    await import('../src/content/index');
    await vi.advanceTimersByTimeAsync(100);
    expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
    await expectStopped();
  });

  it('discards an in-flight verdict that finishes after the runtime disappears', async () => {
    let finish!: (value: unknown) => void;
    const normal = runtime.sendMessage.getMockImplementation()!;
    runtime.sendMessage.mockImplementation(message => message.type === 'ANALYZE' ? new Promise(resolve => { finish = resolve; }) : normal(message));
    await import('../src/content/index');
    await vi.advanceTimersByTimeAsync(100);
    const analyze = runtime.sendMessage.mock.calls.find(([message]) => message.type === 'ANALYZE')![0];
    if (analyze.type !== 'ANALYZE') throw new Error('Expected an analysis request.');
    runtime.id = undefined;
    await vi.advanceTimersByTimeAsync(1000);
    finish({ verdicts: analyze.items.map(item => verdict(item.id)), errors: [] });
    await vi.advanceTimersByTimeAsync(0);
    await expectStopped();
  });

  it('cleans up when a cached page returns with an invalidated runtime', async () => {
    await start();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    runtime.id = undefined;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await expectStopped();
  });

  it('does not retire a valid runtime for a temporary message failure', async () => {
    await start();
    runtime.sendMessage.mockRejectedValueOnce(new Error('The message port closed.'));
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(300);
    expect(runtime.onMessage.removeListener).not.toHaveBeenCalled();
    expect(document.querySelector('[data-no-slop-root]')).not.toBeNull();
    const calls = runtime.sendMessage.mock.calls.length;
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(300);
    expect(runtime.sendMessage.mock.calls.length).toBeGreaterThan(calls);
  });
});
