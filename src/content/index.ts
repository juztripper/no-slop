import { ContentController } from './controller';
import type { RuntimeMessage } from '../shared/contracts';
import { createRuntimeBridge, isInvalidatedContext } from './runtime';

// Isolated MV3 content-script world: no page scripts, remote code, or API keys.
const runtime = chrome.runtime;
const bridge = createRuntimeBridge(runtime, stop);
const controller = new ContentController(document, bridge);
let stopped = false;

function stop(): void {
  if (stopped) return;
  stopped = true;
  controller.dispose();
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
  try { runtime.onMessage.removeListener(onMessage); } catch { /* The runtime may already be gone. */ }
}

function handleError(error: unknown): void {
  const expected = isInvalidatedContext(error) || !bridge.isConnected();
  stop();
  if (!expected) console.error('NO SLOP could not continue on this page.', error);
}

function onMessage(message: RuntimeMessage, _sender: chrome.runtime.MessageSender, respond: (value: unknown) => void): void {
  if (stopped || !bridge.isConnected()) return;
  try {
    if (message.type === 'SETTINGS_CHANGED') controller.updateSettings(message.settings);
    else if (message.type === 'RESTORE_PAGE') controller.restorePage();
    else if (message.type === 'RESCAN_PAGE') controller.rescan();
    else return;
    respond({ ok: true });
  } catch (error) { handleError(error); }
}

function onPageHide(event: PageTransitionEvent): void { if (!event.persisted) stop(); }
function onPageShow(event: PageTransitionEvent): void {
  if (event.persisted && bridge.isConnected()) controller.scan();
}

try {
  if (bridge.isConnected()) {
    runtime.onMessage.addListener(onMessage);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    void controller.start().catch(handleError);
  }
} catch (error) { handleError(error); }
