import { z } from 'zod';
import { AnalyzeRequestSchema, AnalyzeResponseSchema, EMPTY_STATS, SettingsSchema, parseStoredSettings, isAllowlisted, type Settings, type PageStats } from '../shared/contracts';
import { isSensitivePage, normalizeDomain, normalizeEndpoint, publicContentUrl } from '../shared/security';
import { RequestPacer, retryDelay } from './pacing';
import { DirectDetector, DirectError, isValidOpenRouterKey } from './direct';

// Keep service credentials out of content scripts and Chrome Sync.
const storageReady = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' }),
]).then(() => true, () => false);
let saveQueue: Promise<unknown> = Promise.resolve();
let settingsRevision = 0;
const requests = new Map<number, Set<AbortController>>();
const inFlight = new Set<number>();
let activeRequests = 0;
const pacer = new RequestPacer(chrome.storage.session, () => Date.now());
const direct = new DirectDetector(chrome.storage.local);
const OPENROUTER_ORIGIN = 'https://openrouter.ai';

async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  return parseStoredSettings(data.settings);
}
function publicSettings(settings: Settings): Settings { return { ...settings, serviceToken:'', openRouterKey:'' }; }
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
  if (settings.openRouterKey && !isValidOpenRouterKey(settings.openRouterKey)) throw new Error('Enter a valid OpenRouter API key, or clear the field to remove it.');
  const connectionChanged = settings.connectionMode !== previous.connectionMode ||
    settings.openRouterKey !== previous.openRouterKey ||
    settings.endpoint !== normalizeEndpoint(previous.endpoint) || settings.serviceToken !== previous.serviceToken;
  if (connectionChanged || (settings.connectionMode === 'direct' && !settings.openRouterKey)) settings.consent = false;
  settings.allowlist = [...new Set(settings.allowlist.map(normalizeDomain))];
  settingsRevision++;
  cancelRequests();
  await chrome.storage.local.set({ settings });
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => tab.id === undefined ? Promise.resolve() : sendTab(tab.id, { type:'SETTINGS_CHANGED', settings:publicSettings(settings) })));
  return settings;
}

const StatsSchema = z.object({ scanned:z.number().int().min(0).max(100000), filtered:z.number().int().min(0).max(100000), uncertain:z.number().int().min(0).max(100000), status:z.enum(['idle','scanning','waiting','ready','error','paused']), error:z.string().max(200).optional() });
async function updateStats(tabId: number, stats: PageStats) {
  await chrome.storage.session.set({ [`tab:${tabId}`]: stats });
  await chrome.action.setBadgeText({ tabId, text: stats.filtered ? String(stats.filtered) : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color:'#C5354D' });
}

async function analyze(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId !== 0 || !sender.url || isSensitivePage(sender.url)) throw new Error('This page is excluded from analysis.');
  await saveQueue;
  const revision = settingsRevision;
  const settings = await getSettings();
  if (revision !== settingsRevision) throw new Error('Settings changed. Scan again to use your current preferences.');
  if (!settings.consent || !settings.enabled || isAllowlisted(new URL(sender.url).hostname, settings.allowlist)) throw new Error('Filtering is paused.');
  if (settings.connectionMode === 'direct' && !isValidOpenRouterKey(settings.openRouterKey)) throw new Error('Add your OpenRouter key in settings to start filtering.');
  const request = AnalyzeRequestSchema.parse({ items:message.items, inspectThumbnails:false, inspectDestinations:settings.connectionMode === 'server' && settings.inspectDestinations });
  request.items = request.items.filter(item => settings.platforms[item.platform]).map(item => ({ ...item, url:settings.connectionMode === 'server' ? publicContentUrl(item.url, request.inspectDestinations) : undefined, thumbnailUrl:undefined }));
  if (!request.items.length) return { verdicts:[], errors:[] };
  if (activeRequests >= 4 || inFlight.has(tabId)) return { status:'deferred', reason:'busy', retryAfterMs:2000 };
  const controller = new AbortController();
  const controllers = requests.get(tabId) || new Set<AbortController>();
  controllers.add(controller); requests.set(tabId, controllers); inFlight.add(tabId); activeRequests++;
  // Finish before Chrome's 30-second service-worker fetch deadline.
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 28000);
  try {
    const endpoint = settings.connectionMode === 'direct' ? OPENROUTER_ORIGIN : normalizeEndpoint(settings.endpoint);
    const delay = await pacer.reserve(endpoint);
    controller.signal.throwIfAborted();
    if (delay) return { status:'deferred', reason:'pacing', retryAfterMs:delay };
    if (settings.connectionMode === 'direct') {
      try {
        const result = await direct.analyze(request, { apiKey:settings.openRouterKey, dailyCallLimit:settings.dailyCallLimit }, controller.signal);
        controller.signal.throwIfAborted();
        return result;
      } catch (error) {
        controller.signal.throwIfAborted();
        if (error instanceof DirectError && error.retryAfterMs !== undefined) {
          const retryAfterMs = Math.min(3_600_000, Math.max(1000, error.retryAfterMs));
          await pacer.defer(endpoint, retryAfterMs);
          return { status:'deferred', reason:'rate-limit', retryAfterMs };
        }
        throw error;
      }
    }
    const response = await fetch(`${endpoint}/v1/analyze`, {
      method:'POST', headers:{ 'Content-Type':'application/json', ...(settings.serviceToken ? { Authorization:`Bearer ${settings.serviceToken}` } : {}) },
      body:JSON.stringify(request), signal:controller.signal, credentials:'omit', redirect:'error', cache:'no-store',
    });
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfterMs = retryDelay(response.headers.get('Retry-After'));
        await pacer.defer(endpoint, retryAfterMs);
        controller.signal.throwIfAborted();
        return { status:'deferred', reason:'rate-limit', retryAfterMs };
      }
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
  if (!await storageReady) throw new Error('NO SLOP could not secure its local storage. Reload the extension before trying again.');
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
    await saveQueue;
    const settings = await getSettings();
    if (settings.connectionMode === 'direct') return checkOpenRouterKey(settings.openRouterKey);
    try {
      const response = await fetch(`${normalizeEndpoint(settings.endpoint)}/health`, { signal:AbortSignal.timeout(8000), credentials:'omit', redirect:'error', cache:'no-store' });
      if (!response.ok) return { ok:false, error:`Service returned ${response.status}.` };
      const body = await response.json() as { ok?:boolean; status?:string };
      return { ok:body.ok === true || body.status === 'ok', error:body.ok === true || body.status === 'ok' ? undefined : 'Service is not ready.' };
    } catch { return { ok:false, error:'Cannot reach the detector. Start the service or check its address.' }; }
  }
  throw new Error('Unknown request.');
}

/** Authentication check only: sends no page text and makes no inference request. */
async function checkOpenRouterKey(apiKey: string) {
  if (!isValidOpenRouterKey(apiKey)) return { ok:false, error:'Save your OpenRouter API key first.' };
  try {
    const response = await fetch(`${OPENROUTER_ORIGIN}/api/v1/key`, {
      headers:{ Authorization:`Bearer ${apiKey}` }, signal:AbortSignal.timeout(8000),
      credentials:'omit', redirect:'error', cache:'no-store',
    });
    if (response.status === 401 || response.status === 403) return { ok:false, error:'OpenRouter rejected this key. Check that it is active and saved correctly.' };
    if (response.status === 429) return { ok:false, error:'OpenRouter is rate limiting requests. Try checking again shortly.' };
    if (!response.ok) return { ok:false, error:`OpenRouter is unavailable (${response.status}). Try again shortly.` };
    const text = await response.text();
    if (text.length > 20000) return { ok:false, error:'Unexpected OpenRouter response. Try again shortly.' };
    const result = z.object({ data:z.object({
      label:z.string(), limit_remaining:z.number().nullable().optional(),
      is_management_key:z.boolean().optional(), is_provisioning_key:z.boolean().optional(),
    }) }).safeParse(JSON.parse(text));
    if (!result.success) return { ok:false, error:'Unexpected OpenRouter response. Try again shortly.' };
    if (result.data.data.is_management_key || result.data.data.is_provisioning_key) return { ok:false, error:'Use a regular OpenRouter API key for inference, not a management key.' };
    if (result.data.data.limit_remaining !== undefined && result.data.data.limit_remaining !== null && result.data.data.limit_remaining <= 0) return { ok:false, error:'This OpenRouter key has reached its spending limit. Review its limit in OpenRouter.' };
    return { ok:true };
  } catch { return { ok:false, error:'Cannot reach OpenRouter. Check your connection and try again.' }; }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  void handle(message,sender).then(respond).catch(error => respond({ error: error instanceof z.ZodError ? 'Invalid settings or content data.' : error instanceof Error && error.name === 'AbortError' ? 'Analysis interrupted. Content stays visible.' : error instanceof Error ? error.message : 'The request failed.' }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { requests.get(tabId)?.forEach(c => c.abort()); void chrome.storage.session.remove(`tab:${tabId}`); });
chrome.tabs.onUpdated.addListener((tabId,change) => { if (change.status === 'loading') { requests.get(tabId)?.forEach(c => c.abort()); void updateStats(tabId,EMPTY_STATS); } });
chrome.runtime.onInstalled.addListener(details => { if (details.reason === 'install') void chrome.runtime.openOptionsPage(); });
