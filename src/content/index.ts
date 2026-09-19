import { ContentController } from './controller';
import type { RuntimeMessage } from '../shared/contracts';

// Isolated MV3 content-script world: no page scripts, remote code, or API keys.
const controller = new ContentController(document, { send: message => chrome.runtime.sendMessage(message) });
chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, respond) => {
  if (message.type === 'SETTINGS_CHANGED') controller.updateSettings(message.settings);
  else if (message.type === 'RESTORE_PAGE') controller.restorePage();
  else if (message.type === 'RESCAN_PAGE') controller.rescan();
  else return;
  respond({ ok: true });
});
window.addEventListener('pagehide', event => { if (!event.persisted) controller.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) controller.scan(); });
void controller.start();
