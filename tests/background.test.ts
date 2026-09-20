import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/contracts';

const runtimeId = 'a'.repeat(32);
const ui = { id:runtimeId, url:`chrome-extension://${runtimeId}/options.html` };
const content = { id:runtimeId, url:'https://www.youtube.com/', frameId:0, tab:{ id:1 } };
const item = { id:'first', platform:'youtube', kind:'video', title:'A practical woodworking guide', text:'How I cut and tested each joint.' };
let listener: (msg:unknown,sender:unknown,respond:(r:any)=>void)=>boolean;
let local: Record<string,any>;
let session: Record<string,any>;
const mockStorage = (getData:()=>Record<string,any>) => ({
  get: vi.fn(async (key:string|string[]) => Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k,getData()[k]]))),
  set: vi.fn(async (value:Record<string,any>) => { Object.assign(getData(),value); }),
  remove: vi.fn(async (key:string) => { delete getData()[key]; }),
  setAccessLevel: vi.fn(async () => undefined),
});
async function send(msg:unknown, sender:unknown = ui) { return new Promise<any>(resolve => listener(msg,sender,resolve)); }
beforeEach(async () => {
  vi.resetModules();
  local = { settings:{ ...structuredClone(DEFAULT_SETTINGS), connectionMode:'server', consent:true, serviceToken:'private-service-token' } }; session = {};
  vi.stubGlobal('chrome', {
    storage:{ local:mockStorage(()=>local), session:mockStorage(()=>session) },
    runtime:{ id:runtimeId, getURL:(s:string)=>`chrome-extension://${runtimeId}/${s}`, openOptionsPage:vi.fn(), onMessage:{addListener:(fn:typeof listener)=>{listener=fn;}}, onInstalled:{addListener:vi.fn()} },
    tabs:{ query:vi.fn(async()=>[{id:1,url:'https://www.youtube.com/'}]), sendMessage:vi.fn(async()=>({ok:true})), onRemoved:{addListener:vi.fn()},onUpdated:{addListener:vi.fn()} },
    action:{setBadgeText:vi.fn(async()=>undefined),setBadgeBackgroundColor:vi.fn(async()=>undefined)},
  });
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({verdicts:[],errors:[]}),{status:200})));
  await import('../src/background/index');
});

const testKey = `sk-or-v1-${'test-only-'.repeat(6)}`;
const providerDecision = {
  model:'~typesafe/jev-latest',
  answers:Object.fromEntries(Object.entries({low_quality:.95,synthetic:.9,clickbait:.9,enough_evidence:.99}).map(([name,noul])=>[name,{type:'noul',noul}])),
};

describe('direct OpenRouter setup and routing', () => {
  it('defaults a new install to direct mode with analysis disabled until consent', async () => {
    delete local.settings;
    expect(await send({type:'GET_SETTINGS'})).toMatchObject({connectionMode:'direct',openRouterKey:'',consent:false,inspectDestinations:false,dailyCallLimit:100});
    expect(await send({type:'ANALYZE',items:[item]},content)).toHaveProperty('error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps legacy installs on their existing server without silently rerouting consent', async () => {
    delete local.settings.connectionMode;
    local.settings.endpoint='https://detector.example';
    expect(await send({type:'GET_SETTINGS'})).toMatchObject({connectionMode:'server',consent:true,endpoint:'https://detector.example'});
    await send({type:'SAVE_SETTINGS',settings:{animations:false}});
    expect(local.settings).toMatchObject({connectionMode:'server',consent:true});
  });

  it('redacts both credentials from content scripts and tab broadcasts', async () => {
    local.settings.openRouterKey=testKey;
    expect(await send({type:'GET_SETTINGS'},content)).toMatchObject({openRouterKey:'',serviceToken:''});
    expect((await send({type:'GET_SETTINGS'})).openRouterKey).toBe(testKey);
    await send({type:'SAVE_SETTINGS',settings:{animations:false}});
    for (const [,message] of vi.mocked(chrome.tabs.sendMessage).mock.calls) {
      expect(JSON.stringify(message)).not.toContain(testKey);
      expect(JSON.stringify(message)).not.toContain('private-service-token');
    }
    expect(chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({accessLevel:'TRUSTED_CONTEXTS'});
  });

  it('requires fresh consent after switching mode or replacing/removing the key', async () => {
    expect(await send({type:'SAVE_SETTINGS',settings:{connectionMode:'direct',openRouterKey:testKey,consent:true}})).toMatchObject({consent:false});
    await send({type:'SAVE_SETTINGS',settings:{consent:true}});
    expect(local.settings.consent).toBe(true);
    await send({type:'SAVE_SETTINGS',settings:{openRouterKey:`${testKey}changed`,consent:true}});
    expect(local.settings.consent).toBe(false);
    await send({type:'SAVE_SETTINGS',settings:{openRouterKey:'',consent:true}});
    expect(local.settings.consent).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed keys and allowance changes without echoing credentials', async () => {
    for (const settings of [{openRouterKey:'not-a-key-private'}, {dailyCallLimit:0}, {dailyCallLimit:10001}, {dailyCallLimit:1.5}]) {
      expect(await send({type:'SAVE_SETTINGS',settings})).toHaveProperty('error');
    }
    expect(local.settings.openRouterKey).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed if Chrome cannot restrict credential storage to trusted contexts', async () => {
    vi.mocked(chrome.storage.local.setAccessLevel).mockRejectedValueOnce(new Error('storage failure'));
    vi.resetModules();
    await import('../src/background/index');
    expect(await send({type:'SAVE_SETTINGS',settings:{openRouterKey:testKey}})).toMatchObject({error:expect.stringContaining('secure its local storage')});
    expect(local.settings.openRouterKey).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never analyzes with settings that were replaced while they were being read', async () => {
    Object.assign(local.settings,{connectionMode:'direct',openRouterKey:testKey});
    let finishRead!: (value:Record<string,unknown>)=>void;
    const oldSettings=structuredClone(local.settings);
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(()=>new Promise(resolve=>{finishRead=resolve;}));
    const pending=send({type:'ANALYZE',items:[item]},content);
    await vi.waitFor(()=>expect(finishRead).toBeDefined());
    await send({type:'SAVE_SETTINGS',settings:{consent:false}});
    finishRead({settings:oldSettings});
    expect(await pending).toHaveProperty('error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves consent when only the daily allowance changes', async () => {
    Object.assign(local.settings,{connectionMode:'direct',openRouterKey:testKey});
    expect(await send({type:'SAVE_SETTINGS',settings:{dailyCallLimit:200}})).toMatchObject({dailyCallLimit:200,consent:true});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('calls only OpenRouter with visible text, no destinations, thumbnails or service token', async () => {
    Object.assign(local.settings,{connectionMode:'direct',openRouterKey:testKey,inspectDestinations:true});
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(providerDecision)));
    const result=await send({type:'ANALYZE',items:[{...item,url:'https://destination.example/private',thumbnailUrl:'https://images.example/private'}]},content);
    expect(result.verdicts?.[0]).toMatchObject({id:'first',category:'ai-slop',evidence:{text:true,thumbnail:false,destination:false}});
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url,options]=vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(options).toMatchObject({credentials:'omit',redirect:'error',cache:'no-store'});
    expect((options?.headers as Record<string,string>).Authorization).toBe(`Bearer ${testKey}`);
    const body=String(options?.body);
    expect(body).toContain(item.title);
    for (const secret of ['destination.example','images.example','private-service-token',testKey]) expect(body).not.toContain(secret);
  });

  it('only checks saved key authentication, without consent, page text or paid inference', async () => {
    Object.assign(local.settings,{connectionMode:'direct',openRouterKey:testKey,consent:false});
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({data:{label:'test',limit_remaining:2}})));
    expect(await send({type:'HEALTH_CHECK'})).toEqual({ok:true});
    expect(fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key',expect.objectContaining({headers:{Authorization:`Bearer ${testKey}`},credentials:'omit',redirect:'error'}));
    expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBeUndefined();
    expect(local.settings.consent).toBe(false);
  });

  it('rejects checks from pages and gives actionable missing, invalid and exhausted key errors', async () => {
    Object.assign(local.settings,{connectionMode:'direct',openRouterKey:''});
    expect(await send({type:'HEALTH_CHECK'},content)).toHaveProperty('error');
    expect(await send({type:'HEALTH_CHECK'})).toMatchObject({ok:false});
    expect(fetch).not.toHaveBeenCalled();
    local.settings.openRouterKey=testKey;
    vi.mocked(fetch).mockResolvedValueOnce(new Response('upstream-private-body',{status:401}));
    const invalid=await send({type:'HEALTH_CHECK'});
    expect(invalid).toMatchObject({ok:false,error:expect.stringContaining('rejected')});
    expect(JSON.stringify(invalid)).not.toContain('upstream-private-body');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({data:{label:'test',limit_remaining:0}})));
    expect(await send({type:'HEALTH_CHECK'})).toMatchObject({ok:false,error:expect.stringContaining('spending limit')});
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({data:{label:'test',is_management_key:true}})));
    expect(await send({type:'HEALTH_CHECK'})).toMatchObject({ok:false,error:expect.stringContaining('management')});
  });

  it('blocks direct processing before consent and stops pending results when key is removed', async () => {
    Object.assign(local.settings,{connectionMode:'direct',openRouterKey:testKey,consent:false});
    expect(await send({type:'ANALYZE',items:[item]},content)).toHaveProperty('error');
    expect(fetch).not.toHaveBeenCalled();
    local.settings.consent=true;
    let finish!: (response:Response)=>void;
    vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=send({type:'ANALYZE',items:[item]},content);
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalled());
    await send({type:'SAVE_SETTINGS',settings:{openRouterKey:''}});
    finish(new Response(JSON.stringify(providerDecision)));
    expect(await pending).toHaveProperty('error');
    expect(local.settings).toMatchObject({openRouterKey:'',consent:false});
  });

  it('shares provider cooldown across tabs', async () => {
    Object.assign(local.settings,{connectionMode:'direct',openRouterKey:testKey});
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':'23'}}));
    const result=await send({type:'ANALYZE',items:[item]},content);
    expect(result).toMatchObject({status:'deferred',reason:'rate-limit'});
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(24000);
    expect(await send({type:'ANALYZE',items:[item]},{...content,tab:{id:2}})).toMatchObject({status:'deferred',reason:'pacing'});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('extension trust boundary', () => {
  it('never exposes the service token to content scripts', async () => {
    expect((await send({type:'GET_SETTINGS'},content)).serviceToken).toBe('');
    expect((await send({type:'GET_SETTINGS'})).serviceToken).toBe('private-service-token');
  });
  it('rejects settings writes from a content script', async () => {
    expect(await send({type:'SAVE_SETTINGS',settings:{endpoint:'https://attacker.example'}},content)).toHaveProperty('error');
    expect(local.settings.endpoint).toBe(DEFAULT_SETTINGS.endpoint);
  });
  it('accepts the options page in a tab but rejects unknown extension pages', async () => {
    expect((await send({type:'GET_SETTINGS'},{...ui,tab:{id:2}})).serviceToken).toBe('private-service-token');
    expect(await send({type:'SAVE_SETTINGS',settings:{enabled:false}},{...ui,url:`chrome-extension://${runtimeId}/untrusted.html`})).toHaveProperty('error');
  });
  it('requires fresh consent when the configured detector changes', async () => {
    const result = await send({type:'SAVE_SETTINGS',settings:{endpoint:'https://new-detector.example/',consent:true}});
    expect(result.endpoint).toBe('https://new-detector.example');
    expect(result.consent).toBe(false);
    expect(await send({type:'ANALYZE',items:[item]},content)).toHaveProperty('error');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('serializes simultaneous preference changes', async () => {
    await Promise.all([send({type:'SAVE_SETTINGS',settings:{aiSlop:false}}),send({type:'SAVE_SETTINGS',settings:{humanSlop:false}})]);
    expect(local.settings.aiSlop).toBe(false); expect(local.settings.humanSlop).toBe(false);
    const calls = vi.mocked(chrome.tabs.sendMessage).mock.calls;
    expect(calls.length).toBe(2);
    expect((calls[0][1] as any).settings.serviceToken).toBe('');
  });
  it('blocks remote content processing before consent or on private pages', async () => {
    local.settings.consent=false;
    expect(await send({type:'ANALYZE',items:[item]},content)).toHaveProperty('error');
    local.settings.consent=true;
    expect(await send({type:'ANALYZE',items:[item]},{...content,url:'https://x.com/messages/1'})).toHaveProperty('error');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('honors domain exceptions even if a content script asks anyway', async () => {
    local.settings.allowlist=['youtube.com'];
    expect(await send({type:'ANALYZE',items:[item]},content)).toHaveProperty('error');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects iframe analysis and batches larger than eight', async () => {
    expect(await send({type:'ANALYZE',items:[item]},{...content,frameId:1})).toHaveProperty('error');
    expect(await send({type:'ANALYZE',items:Array.from({length:9},(_,i)=>({...item,id:String(i)}))},content)).toHaveProperty('error');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('only sends the service token to the configured endpoint', async () => {
    await send({type:'ANALYZE',items:[{...item,url:'https://example.com/article?secret=abc'}]},content);
    const [url,options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://localhost:8787/v1/analyze');
    expect(options?.credentials).toBe('omit'); expect(options?.redirect).toBe('error');
    expect((options?.headers as any).Authorization).toBe('Bearer private-service-token');
    expect(String(options?.body)).not.toContain('secret=abc');
  });
  it('omits thumbnail URLs even when an older installation enabled image analysis', async () => {
    local.settings.inspectThumbnails=true;
    await send({type:'ANALYZE',items:[{...item,thumbnailUrl:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg?private=secret'}]},content);
    const body=JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.items[0]).not.toHaveProperty('thumbnailUrl');
    expect(body.inspectThumbnails).toBe(false);
  });
  it('does not send Google opaque redirect tokens when destination inspection is off', async () => {
    local.settings.inspectDestinations=false;
    await send({type:'ANALYZE',items:[{...item,platform:'google',kind:'search',url:'https://www.google.com/goto?url=ABCD_0123-efgh'}]}, {...content,url:'https://www.google.com/search?q=woodworking'});
    const body=JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.items[0]).not.toHaveProperty('url');
  });
  it('discards a completed response if consent was revoked while it was pending', async () => {
    let finish!: (response:Response)=>void;
    vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=send({type:'ANALYZE',items:[item]},content);
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalled());
    await send({type:'SAVE_SETTINGS',settings:{consent:false}});
    finish(new Response(JSON.stringify({verdicts:[],errors:[]})));
    expect(await pending).toHaveProperty('error');
  });
  it('ends slow requests before Chrome can suspend the service worker', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
      const pending = send({type:'ANALYZE',items:[item]},content);
      await vi.advanceTimersByTimeAsync(28000);
      expect(await pending).toMatchObject({error:expect.stringContaining('took too long')});
      // The canceled request no longer consumes this tab's in-flight slot.
      expect(await send({type:'ANALYZE',items:[item]},content)).toMatchObject({verdicts:[]});
    } finally { vi.useRealTimers(); }
  });
  it('fails open on an unavailable or malformed detector', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('unavailable',{status:503}));
    expect(await send({type:'ANALYZE',items:[item]},content)).toHaveProperty('error');
    delete session.detectorPacing;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({verdicts:[{id:'first',category:'ai-slop',confidence:5}]})));
    expect(await send({type:'ANALYZE',items:[item]},content)).toHaveProperty('error');
  });
  it('shares a server cooldown across tabs without sending repeated requests', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':'23'}}));
    expect(await send({type:'ANALYZE',items:[item]},content)).toEqual({status:'deferred',reason:'rate-limit',retryAfterMs:24000});
    expect(await send({type:'ANALYZE',items:[item]},{...content,tab:{id:2}})).toMatchObject({status:'deferred',reason:'pacing'});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('admits only one simultaneous batch across tabs', async () => {
    const results = await Promise.all([1,2,3].map(id => send({type:'ANALYZE',items:[item]},{...content,tab:{id}})));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results.filter(result=>result.status === 'deferred')).toHaveLength(2);
  });
  it('does not store feed snippets with page counters', async () => {
    await send({type:'PAGE_STATS',stats:{scanned:5,filtered:2,uncertain:1,status:'ready'}},content);
    const state=await send({type:'GET_TAB_STATE'});
    expect(state.stats.filtered).toBe(2); expect(state.hostname).toBe('www.youtube.com');
    expect(Object.keys(session['tab:1'])).toEqual(['scanned','filtered','uncertain','status']);
  });
});
