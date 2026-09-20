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
  get: vi.fn(async (key:string) => ({ [key]:getData()[key] })),
  set: vi.fn(async (value:Record<string,any>) => { Object.assign(getData(),value); }),
  remove: vi.fn(async (key:string) => { delete getData()[key]; }),
  setAccessLevel: vi.fn(async () => undefined),
});
async function send(msg:unknown, sender:unknown = ui) { return new Promise<any>(resolve => listener(msg,sender,resolve)); }
beforeEach(async () => {
  vi.resetModules();
  local = { settings:{ ...structuredClone(DEFAULT_SETTINGS), consent:true, serviceToken:'private-service-token' } }; session = {};
  vi.stubGlobal('chrome', {
    storage:{ local:mockStorage(()=>local), session:mockStorage(()=>session) },
    runtime:{ id:runtimeId, getURL:(s:string)=>`chrome-extension://${runtimeId}/${s}`, openOptionsPage:vi.fn(), onMessage:{addListener:(fn:typeof listener)=>{listener=fn;}}, onInstalled:{addListener:vi.fn()} },
    tabs:{ query:vi.fn(async()=>[{id:1,url:'https://www.youtube.com/'}]), sendMessage:vi.fn(async()=>({ok:true})), onRemoved:{addListener:vi.fn()},onUpdated:{addListener:vi.fn()} },
    action:{setBadgeText:vi.fn(async()=>undefined),setBadgeBackgroundColor:vi.fn(async()=>undefined)},
  });
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({verdicts:[],errors:[]}),{status:200})));
  await import('../src/background/index');
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
