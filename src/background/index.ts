import { z } from 'zod';
import { AnalyzeRequestSchema, AnalyzeResponseSchema, DEFAULT_SETTINGS, EMPTY_STATS, SettingsSchema, isAllowlisted, type Settings, type PageStats } from '../shared/contracts';
import { isSensitivePage, normalizeDomain, normalizeEndpoint, publicContentUrl } from '../shared/security';

// Keep service credentials out of content scripts and Chrome Sync.
void chrome.storage.local.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' });
void chrome.storage.session.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' });
let saveQueue: Promise<unknown> = Promise.resolve();
const requests = new Map<number, Set<AbortController>>();
const inFlight = new Set<number>();
let activeRequests = 0;

async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  const parsed = SettingsSchema.safeParse(data.settings ?? {});
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}
function publicSettings(settings: Settings): Settings { return { ...settings, serviceToken:'' }; }
function trustedUI(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url) return false;
  try {
    const url = new URL(sender.url);
    return ['options.html', 'popup.html', 'index.html'].some(page => `${url.protocol}//${url.host}${url.pathname}` === chrome.runtime.getURL(page));
  } catch { return false; }
}
async function currentTab() { return (await chrome.tabs.query({ active:true, currentWindow:true }))[0]; }
async function sendTab(tabId: number, message: unknown) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch { return undefined; }
}
function cancelRequests() {
  requests.forEach(controllers => controllers.forEach(controller => controller.abort()));
}
async function saveSettings(patch: unknown) {
  const parsed = SettingsSchema.partial().strict().parse(patch);
  // Zod defaults also apply inside partial objects. Only merge keys actually sent,
  // otherwise changing one switch silently resets unrelated user preferences.
  const safe = Object.fromEntries(Object.keys(patch as object).map(key => [key, parsed[key as keyof Settings]]));
  const previous = await getSettings();
  const settings = SettingsSchema.parse({ ...previous, ...safe });
  settings.endpoint = normalizeEndpoint(settings.endpoint);
  if (settings.endpoint !== normalizeEndpoint(previous.endpoint)) settings.consent = false;
  settings.allowlist = [...new Set(settings.allowlist.map(normalizeDomain))];
  await chrome.storage.local.set({ settings });
  cancelRequests();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => tab.id === undefined ? Promise.resolve() : sendTab(tab.id, { type:'SETTINGS_CHANGED', settings:publicSettings(settings) })));
  return settings;
}

const StatsSchema = z.object({ scanned:z.number().int().min(0).max(100000), filtered:z.number().int().min(0).max(100000), uncertain:z.number().int().min(0).max(100000), status:z.enum(['idle','scanning','ready','error','paused']), error:z.string().max(200).optional() });
async function updateStats(tabId: number, stats: PageStats) {
  await chrome.storage.session.set({ [`tab:${tabId}`]: stats });
  await chrome.action.setBadgeText({ tabId, text: stats.filtered ? String(stats.filtered) : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color:'#C5354D' });
}

async function analyze(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId !== 0 || !sender.url || isSensitivePage(sender.url)) throw new Error('This page is excluded from analysis.');
  const settings = await getSettings();
  if (!settings.consent || !settings.enabled || isAllowlisted(new URL(sender.url).hostname, settings.allowlist)) throw new Error('Filtering is paused.');
  const request = AnalyzeRequestSchema.parse({ items:message.items, inspectThumbnails:settings.inspectThumbnails, inspectDestinations:settings.inspectDestinations });
  request.items = request.items.filter(item => settings.platforms[item.platform]).map(item => ({ ...item, url:publicContentUrl(item.url, settings.inspectDestinations), thumbnailUrl:settings.inspectThumbnails ? item.thumbnailUrl : undefined }));
  if (!request.items.length) return { verdicts:[], errors:[] };
  if (activeRequests >= 4 || inFlight.has(tabId)) throw new Error('Detector is busy. Try again shortly.');
  const controller = new AbortController();
  const controllers = requests.get(tabId) || new Set<AbortController>();
  controllers.add(controller); requests.set(tabId, controllers); inFlight.add(tabId); activeRequests++;
  // Finish before Chrome's 30-second service-worker fetch deadline.
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 28000);
  try {
    const response = await fetch(`${normalizeEndpoint(settings.endpoint)}/v1/analyze`, {
      method:'POST', headers:{ 'Content-Type':'application/json', ...(settings.serviceToken ? { Authorization:`Bearer ${settings.serviceToken}` } : {}) },
      body:JSON.stringify(request), signal:controller.signal, credentials:'omit', redirect:'error', cache:'no-store',
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('The free detector has reached its limit. Content stays visible.');
      if (response.status === 401 || response.status === 403) throw new Error('Service access denied. Check your service token in settings.');
      throw new Error(`Detector unavailable (${response.status}). Content stays visible.`);
    }
    const text = await response.text();
    if (text.length > 100000) throw new Error('Unexpected detector response.');
    const parsed = AnalyzeResponseSchema.parse(JSON.parse(text));
    const ids = new Set(request.items.map(item => item.id));
    if (parsed.verdicts.some(v => !ids.has(v.id)) || new Set(parsed.verdicts.map(v => v.id)).size !== parsed.verdicts.length) throw new Error('Unexpected detector response.');
    controller.signal.throwIfAborted();
    return parsed;
  } catch (error) {
    if (timedOut) throw new Error('The detector took too long. Content stays visible; try scanning again.');
    throw error;
  } finally {
    clearTimeout(timeout); controllers.delete(controller); if (!controllers.size) requests.delete(tabId);
    inFlight.delete(tabId); activeRequests--;
  }
}

async function handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') throw new Error('Invalid request.');
  const msg = message as Record<string, unknown>;
  if (msg.type === 'GET_SETTINGS') return trustedUI(sender) ? await getSettings() : publicSettings(await getSettings());
  if (msg.type === 'ANALYZE') return analyze(msg,sender);
  if (msg.type === 'PAGE_STATS') {
    if (sender.tab?.id !== undefined && sender.frameId === 0) await updateStats(sender.tab.id,StatsSchema.parse(msg.stats));
    return { ok:true };
  }
  if (!trustedUI(sender)) throw new Error('This action is only available in NO SLOP settings.');
  if (msg.type === 'SAVE_SETTINGS') {
    const pending = saveQueue.then(() => saveSettings(msg.settings));
    saveQueue = pending.catch(() => undefined); return pending;
  }
  if (msg.type === 'GET_TAB_STATE') {
    const tab = await currentTab();
    const key = `tab:${tab?.id}`;
    const data = await chrome.storage.session.get(key);
    let hostname = ''; try { hostname = new URL(tab?.url || '').hostname; } catch { /* Protected browser page. */ }
    return { url:tab?.url || '', hostname, stats:data[key] || EMPTY_STATS };
  }
  if (msg.type === 'RESTORE_PAGE' || msg.type === 'RESCAN_PAGE') {
    const tab = await currentTab();
    if (tab?.id === undefined) return { ok:false };
    return { ok: (await sendTab(tab.id,{ type:msg.type })) !== undefined };
  }
  if (msg.type === 'HEALTH_CHECK') {
    const settings = await getSettings();
    try {
      const response = await fetch(`${normalizeEndpoint(settings.endpoint)}/health`, { signal:AbortSignal.timeout(8000), credentials:'omit', redirect:'error', cache:'no-store' });
      if (!response.ok) return { ok:false, error:`Service returned ${response.status}.` };
      const body = await response.json() as { ok?:boolean; status?:string };
      return { ok:body.ok === true || body.status === 'ok', error:body.ok === true || body.status === 'ok' ? undefined : 'Service is not ready.' };
    } catch { return { ok:false, error:'Cannot reach the detector. Start the service or check its address.' }; }
  }
  throw new Error('Unknown request.');
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  void handle(message,sender).then(respond).catch(error => respond({ error: error instanceof z.ZodError ? 'Invalid settings or content data.' : error instanceof Error && error.name === 'AbortError' ? 'Analysis interrupted. Content stays visible.' : error instanceof Error ? error.message : 'The request failed.' }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { requests.get(tabId)?.forEach(c => c.abort()); void chrome.storage.session.remove(`tab:${tabId}`); });
chrome.tabs.onUpdated.addListener((tabId,change) => { if (change.status === 'loading') { requests.get(tabId)?.forEach(c => c.abort()); void updateStats(tabId,EMPTY_STATS); } });
chrome.runtime.onInstalled.addListener(details => { if (details.reason === 'install') void chrome.runtime.openOptionsPage(); });
