// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/contracts';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/ui/bridge', () => ({ request, isExtension: true }));
import { useSettings } from '../src/ui/useSettings';

let root: Root;
let state: ReturnType<typeof useSettings>;
let stored: Settings;
function Harness() { state = useSettings(); return null; }

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  stored = structuredClone(DEFAULT_SETTINGS);
  request.mockReset().mockImplementation(async message => {
    if (message.type === 'GET_SETTINGS') return structuredClone(stored);
    stored = { ...stored, ...message.settings };
    return structuredClone(stored);
  });
  const container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Harness)); });
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('settings persistence', () => {
  it('sends only the changed preference and adopts the confirmed server state', async () => {
    // A second extension window changed a preference after this one loaded.
    stored.humanSlop = false;
    await act(async () => { await state.update({ aiSlop: false }); });
    expect(request).toHaveBeenLastCalledWith({ type:'SAVE_SETTINGS', settings:{ aiSlop:false } });
    expect(state.settings).toMatchObject({ aiSlop:false, humanSlop:false });
  });

  it('rolls back multiple failed optimistic updates to the last confirmed settings', async () => {
    request.mockRejectedValue(new Error('Storage unavailable.'));
    await act(async () => {
      const first = state.update({ aiSlop:false });
      const second = state.update({ humanSlop:false });
      expect(await first).toBe(false); expect(await second).toBe(false);
    });
    expect(state.settings).toMatchObject({ aiSlop:true, humanSlop:true });
    expect(state.error).toBe('Storage unavailable.');
    expect(state.saveState).toBe('');
  });

  it('serializes rapid updates without losing a prior change', async () => {
    await act(async () => {
      await Promise.all([state.update({ animations:false }), state.update({ threshold:.95 })]);
    });
    expect(stored).toMatchObject({ animations:false, threshold:.95 });
    expect(state.settings).toMatchObject({ animations:false, threshold:.95 });
    expect(state.saveState).toBe('Changes saved');
  });
});
