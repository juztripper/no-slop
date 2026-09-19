// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type RuntimeMessage } from '../src/shared/contracts';

const calls = vi.hoisted(() => ({ start: vi.fn(async () => {}), updateSettings: vi.fn(), restorePage: vi.fn(), rescan: vi.fn(), scan: vi.fn(), dispose: vi.fn() }));
vi.mock('../src/content/controller', () => ({ ContentController: class { start = calls.start; updateSettings = calls.updateSettings; restorePage = calls.restorePage; rescan = calls.rescan; scan = calls.scan; dispose = calls.dispose; } }));
let listener: (message: RuntimeMessage, sender: unknown, respond: (value: unknown) => void) => void;
let windowEvents: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  windowEvents = vi.spyOn(window, 'addEventListener');
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn(callback => { listener = callback; }) } } });
  await import('../src/content/index');
});
afterAll(() => {
  for (const [type, callback] of windowEvents.mock.calls) if (typeof type === 'string' && callback) window.removeEventListener(type, callback);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MV3 entry integration', () => {
  it('acknowledges page actions so the popup does not report a false failure', () => {
    for (const message of [{ type: 'RESTORE_PAGE' }, { type: 'RESCAN_PAGE' }, { type: 'SETTINGS_CHANGED', settings: DEFAULT_SETTINGS }] as RuntimeMessage[]) {
      const respond = vi.fn();
      listener(message, {}, respond);
      expect(respond).toHaveBeenCalledWith({ ok: true });
    }
    expect(calls.restorePage).toHaveBeenCalledOnce();
    expect(calls.rescan).toHaveBeenCalledOnce();
    expect(calls.updateSettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it('retains the controller when returning from the browser back-forward cache', () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(calls.dispose).not.toHaveBeenCalled();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(calls.scan).toHaveBeenCalledOnce();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(calls.dispose).toHaveBeenCalledOnce();
  });
});
