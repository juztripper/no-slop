// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Theme } from '@radix-ui/themes';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/contracts';

const bridge = vi.hoisted(() => ({ request: vi.fn(), extension: true }));
vi.mock('../src/ui/bridge', () => ({ request: bridge.request, get isExtension() { return bridge.extension; } }));
import { PrivacySettings } from '../src/ui/preferences';

let root: Root;
let container: HTMLDivElement;
let initial: Settings;
const save = vi.fn();
function Harness() {
  const [settings, setSettings] = useState(initial);
  async function update(patch: Partial<Settings>) {
    const result = await save(patch);
    if (result === false) return false;
    setSettings(value => {
      const next = { ...value, ...patch };
      if (next.connectionMode !== value.connectionMode || next.openRouterKey !== value.openRouterKey ||
        next.endpoint !== value.endpoint || next.serviceToken !== value.serviceToken) next.consent = false;
      return next;
    });
    return true;
  }
  return createElement(Theme, null, createElement(PrivacySettings, { settings, update }));
}
async function render(patch: Partial<Settings> = {}) {
  initial = { ...structuredClone(DEFAULT_SETTINGS), ...patch };
  await act(async () => root.render(createElement(Harness)));
}
function input(id: string) { return container.querySelector<HTMLInputElement>(`#${id}`)!; }
function button(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
}
function consentSwitch() {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(node =>
    document.getElementById(node.getAttribute('aria-labelledby')!)?.textContent === 'Allow content analysis')!;
}
async function enter(id: string, value: string) {
  await act(async () => {
    const field = input(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(node: HTMLElement) { await act(async () => node.click()); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  bridge.extension = true;
  bridge.request.mockReset().mockResolvedValue({ ok: true });
  save.mockReset().mockResolvedValue(true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('direct connection setup', () => {
  it('requires an explicitly saved key before checking or enabling analysis', async () => {
    await render();
    expect(input('openrouter-key').type).toBe('password');
    expect(input('endpoint')).toBeNull();
    expect(button('Check connection').disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
    await enter('openrouter-key', 'test-only-key');
    expect(save).not.toHaveBeenCalled();
    expect(button('Check connection').disabled).toBe(true);
    await click(button('Save connection'));
    expect(save).toHaveBeenLastCalledWith({ connectionMode: 'direct', openRouterKey: 'test-only-key', dailyCallLimit: 100 });
    expect(button('Check connection').disabled).toBe(false);
    await click(button('Check connection'));
    expect(bridge.request).toHaveBeenCalledExactlyOnceWith({ type: 'HEALTH_CHECK' });
    expect(container.textContent).toContain('This check did not run paid analysis');
    await click(container.querySelector<HTMLButtonElement>('[role="switch"]')!);
    expect(save).toHaveBeenLastCalledWith({ consent: true });
  });

  it('saves advanced mode explicitly and revokes existing consent', async () => {
    await render({ openRouterKey: 'saved-test-key', consent: true });
    const server = container.querySelector<HTMLButtonElement>('[role="radio"][value="server"]')!;
    await click(server);
    expect(save).not.toHaveBeenCalled();
    expect(input('endpoint').value).toBe('http://localhost:8787');
    expect(container.textContent).toContain('Inspect search destinations');
    expect(button('Check connection').disabled).toBe(true);
    await click(button('Save connection'));
    expect(save).toHaveBeenLastCalledWith({ connectionMode: 'server', endpoint: 'http://localhost:8787', serviceToken: '' });
    expect(button('Check connection').disabled).toBe(false);
    expect(consentSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('requires fresh consent after replacing an existing key', async () => {
    await render({ openRouterKey: 'saved-test-key', consent: true });
    await enter('openrouter-key', 'replacement-test-key');
    expect(consentSwitch().getAttribute('aria-checked')).toBe('true');
    await click(button('Save connection'));
    expect(save).toHaveBeenLastCalledWith({ connectionMode: 'direct', openRouterKey: 'replacement-test-key', dailyCallLimit: 100 });
    expect(consentSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('preserves consent when only the request allowance changes', async () => {
    await render({ openRouterKey: 'saved-test-key', consent: true });
    await enter('daily-call-limit', '50');
    await click(button('Save connection'));
    expect(save).toHaveBeenLastCalledWith({ connectionMode: 'direct', openRouterKey: 'saved-test-key', dailyCallLimit: 50 });
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain('Content analysis is still allowed');
  });

  it('surfaces a failed free connection check without claiming a connection', async () => {
    await render({ openRouterKey: 'saved-test-key' });
    bridge.request.mockRejectedValue(new Error('This OpenRouter key is no longer valid.'));
    await click(button('Check connection'));
    expect(container.textContent).toContain('This OpenRouter key is no longer valid.');
    expect(container.textContent).not.toContain('Connected to OpenRouter');
    expect(button('Check connection').disabled).toBe(false);
  });

  it('removes the saved key and turns analysis off', async () => {
    await render({ openRouterKey: 'saved-test-key', consent: true });
    await click(button('Remove key'));
    expect(save).toHaveBeenLastCalledWith({ openRouterKey: '', consent: false });
    expect(input('openrouter-key').value).toBe('');
    expect(button('Check connection').disabled).toBe(true);
    expect(container.textContent).toContain('API key removed');
  });

  it('reports failed saves and keeps checks disabled for an unsaved key', async () => {
    await render();
    save.mockResolvedValue(false);
    await enter('openrouter-key', 'test-only-key');
    await click(button('Save connection'));
    expect(container.textContent).toContain('connection could not be saved');
    expect(button('Check connection').disabled).toBe(true);
    expect(bridge.request).not.toHaveBeenCalled();
  });

  it('keeps credential entry, saving, connection checks and consent disabled in the web preview', async () => {
    bridge.extension = false;
    await render({ openRouterKey: 'should-not-render', serviceToken: 'should-not-render' });
    expect(input('openrouter-key').value).toBe('');
    expect(input('openrouter-key').disabled).toBe(true);
    expect(button('Save connection').disabled).toBe(true);
    expect(button('Check connection').disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
    await click(container.querySelector<HTMLButtonElement>('[role="radio"][value="server"]')!);
    expect(input('service-token').value).toBe('');
    expect(input('service-token').disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(bridge.request).not.toHaveBeenCalled();
  });
});
