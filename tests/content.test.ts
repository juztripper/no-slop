// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ContentItem, type RuntimeMessage, type Settings, type Verdict } from '../src/shared/contracts';
import { extractCandidates } from '../src/content/adapters';
import { ContentController, type RuntimeBridge } from '../src/content/controller';
import { presentCandidate } from '../src/content/presentation';

const settings = (overrides: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, consent: true, animations: false, ...overrides });
const verdict = (id: string, overrides: Partial<Verdict> = {}): Verdict => ({ id, category: 'ai-slop', confidence: .94, reasons: ['Repetitive claims with no usable supporting information.'], signals: { lowQuality: .95, synthetic: .9, clickbait: .8 }, evidence: { text: true, thumbnail: false, destination: false }, model: '~typesafe/jev-latest', ...overrides });
const card = (title = 'An original hand-built workbench demonstration', index = 0) => `<ytd-video-renderer data-card="${index}"><a id="video-title" href="/watch?v=abcdefghi${String(index).padStart(2, '0')}">${title}</a><div class="metadata-snippet-text">A description of the demonstration.</div><button>More</button></ytd-video-renderer>`;
const controllers: ContentController[] = [];

function bridge(config: Settings = settings(), analyze: (items: ContentItem[]) => Promise<unknown> = async items => ({ verdicts: items.map(item => verdict(item.id)) })): RuntimeBridge & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (message: RuntimeMessage) => {
    if (message.type === 'GET_SETTINGS') return config;
    if (message.type === 'ANALYZE') return analyze(message.items);
    return undefined;
  }) };
}

async function start(runtime: RuntimeBridge, markup = card()): Promise<ContentController> {
  document.body.innerHTML = markup;
  const controller = new ContentController(document, runtime);
  controllers.push(controller);
  await controller.start();
  await vi.advanceTimersByTimeAsync(100);
  return controller;
}

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, '', '/');
  document.body.innerHTML = '';
});
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('presentation and restoration', () => {
  it('censors a whole card without replacing page-owned nodes and restores exact styles and inert values', () => {
    document.body.innerHTML = `<ytd-video-renderer style="color:red; --layout: 3;"><a id="video-title" style="color: blue" inert="inert">A practical woodworking demonstration</a><button>Existing button</button></ytd-video-renderer>`;
    const [candidate] = extractCandidates(document, new URL(location.href));
    const original = candidate.element.innerHTML;
    const originalStyle = candidate.element.getAttribute('style');
    const anchor = candidate.element.querySelector('a');
    const presentation = presentCandidate(candidate, verdict(candidate.item.id), settings(), vi.fn());
    expect(candidate.element.querySelector('[data-no-slop-root]')).not.toBeNull();
    expect(anchor?.style.visibility).toBe('hidden');
    expect(candidate.element.querySelector('a')).toBe(anchor);
    presentation.restore();
    expect(candidate.element.getAttribute('style')).toBe(originalStyle);
    expect(candidate.element.innerHTML).toBe(original);
    presentation.restore();
    expect(candidate.element.innerHTML).toBe(original);
  });

  it('reveal is keyboard-accessible, runs once, and renders reasons as text rather than HTML', () => {
    const shadow = vi.spyOn(Element.prototype, 'attachShadow');
    document.body.innerHTML = card();
    const [candidate] = extractCandidates(document, new URL(location.href));
    const reveal = vi.fn();
    presentCandidate(candidate, verdict(candidate.item.id, { reasons: ['<img src=x onerror=alert(1)> is untrusted model text'] }), settings(), reveal);
    const root = shadow.mock.results[0].value as ShadowRoot;
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    const button = root.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Show original content');
    button.click();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(candidate.element.querySelector('[data-no-slop-root]')).toBeNull();
  });

  it('hides the whole card immediately with reduced motion and restores no-style attributes faithfully', () => {
    document.body.innerHTML = card();
    const [candidate] = extractCandidates(document, new URL(location.href));
    const animate = vi.fn();
    candidate.element.animate = animate;
    const presentation = presentCandidate(candidate, verdict(candidate.item.id), settings({ mode: 'hide', animations: true }), vi.fn(), true);
    expect(animate).not.toHaveBeenCalled();
    expect(candidate.element.style.display).toBe('none');
    expect(candidate.element.querySelector('button')).not.toBeNull();
    presentation.restore();
    expect(candidate.element.hasAttribute('style')).toBe(false);
  });

  it('collapses with one cancellable animation when motion is allowed', async () => {
    document.body.innerHTML = card();
    const [candidate] = extractCandidates(document, new URL(location.href));
    let finish!: () => void;
    const animation = { finished: new Promise<void>(resolve => { finish = resolve; }), cancel: vi.fn() };
    candidate.element.animate = vi.fn(() => animation as unknown as Animation);
    const presentation = presentCandidate(candidate, verdict(candidate.item.id), settings({ mode: 'hide', animations: true }), vi.fn());
    expect(candidate.element.style.display).not.toBe('none');
    finish();
    await Promise.resolve();
    expect(candidate.element.style.display).toBe('none');
    presentation.restore();
    expect(animation.cancel).toHaveBeenCalledOnce();
    expect(candidate.element.hasAttribute('style')).toBe(false);
  });

  it('keeps paragraphs readable even when hide mode is selected', () => {
    const paragraph = 'A long passage with all its original context and meaning available to readers. '.repeat(4);
    document.body.innerHTML = `<main><article><p style="line-height: 1.7">${paragraph}</p></article></main>`;
    const [candidate] = extractCandidates(document, new URL('https://example.com/article'));
    const presentation = presentCandidate(candidate, verdict(candidate.item.id), settings({ mode: 'hide' }), vi.fn());
    expect(presentation.mode).toBe('annotation');
    expect(candidate.element.textContent).toBe(paragraph);
    expect(candidate.element.getAttribute('style')).toBe('line-height: 1.7');
    expect(candidate.element.nextElementSibling?.hasAttribute('data-no-slop-root')).toBe(true);
    presentation.restore();
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
  });
});

describe('page lifecycle and bounded work', () => {
  it('does not send any content before consent, when paused, or on allowlisted sites', async () => {
    for (const config of [settings({ consent: false }), settings({ enabled: false }), settings({ allowlist: ['youtube.com'] })]) {
      const runtime = bridge(config);
      const controller = await start(runtime);
      expect(runtime.send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
      expect(controller.pageStats.status).toBe('paused');
      controller.dispose();
    }
  });

  it('batches at most four items with one request in flight and never starts an animation for uncertain content', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const runtime = bridge(settings(), async items => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 50));
      inFlight--;
      return { verdicts: items.map(item => verdict(item.id, { category: 'uncertain' })) };
    });
    const controller = await start(runtime, Array.from({ length: 11 }, (_, i) => card(`An independent detailed demonstration number ${i}`, i)).join(''));
    await vi.advanceTimersByTimeAsync(500);
    const requests = runtime.send.mock.calls.map(([message]) => message).filter(message => message.type === 'ANALYZE');
    expect(requests.map(request => request.items.length)).toEqual([4, 4, 3]);
    expect(maxInFlight).toBe(1);
    expect(controller.pageStats.scanned).toBe(11);
    expect(controller.pageStats.uncertain).toBe(11);
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
  });

  it('reuses cached verdicts immediately when the filtering threshold changes', async () => {
    const runtime = bridge(settings({ threshold: .98 }));
    const controller = await start(runtime);
    expect(controller.pageStats.filtered).toBe(0);
    controller.updateSettings(settings({ threshold: .85 }));
    expect(controller.pageStats.filtered).toBe(1);
    expect(document.querySelector('[data-no-slop-root]')).not.toBeNull();
    controller.updateSettings(settings({ threshold: .98 }));
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
    expect(runtime.send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(1);
  });

  it('restores the full page on pause and preserves the manual restore until an explicit rescan', async () => {
    const controller = await start(bridge(settings({ mode: 'hide' })));
    const element = document.querySelector('ytd-video-renderer') as HTMLElement;
    expect(element.style.display).toBe('none');
    controller.updateSettings(settings({ enabled: false, mode: 'hide' }));
    expect(element.hasAttribute('style')).toBe(false);
    controller.updateSettings(settings({ mode: 'hide' }));
    expect(element.style.display).toBe('none');
    controller.restorePage();
    controller.scan();
    expect(element.hasAttribute('style')).toBe(false);
    expect(controller.pageStats.status).toBe('paused');
    controller.rescan();
    await vi.advanceTimersByTimeAsync(150);
    expect(element.style.display).toBe('none');
  });

  it('analyzes dynamically inserted cards and rechecks content recycled into a censored node', async () => {
    const runtime = bridge();
    const controller = await start(runtime);
    const initial = document.querySelector('ytd-video-renderer')!;
    initial.querySelector('a')!.textContent = 'Completely different text recycled into the same node';
    document.body.insertAdjacentHTML('beforeend', card('A second freshly inserted woodworking demonstration', 1));
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.pageStats.scanned).toBe(3);
    expect(document.querySelectorAll('[data-no-slop-root]')).toHaveLength(2);
    expect(runtime.send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(2);
    controller.restorePage();
    expect(initial.querySelector('a')!.textContent).toContain('Completely different');
    expect(initial.querySelector('a')!.hasAttribute('inert')).toBe(false);
  });

  it('does not apply stale responses after settings change or private SPA navigation', async () => {
    let answer!: (value: unknown) => void;
    let items: ContentItem[] = [];
    const runtime = bridge(settings(), batch => { items = batch; return new Promise(resolve => { answer = resolve; }); });
    const controller = await start(runtime);
    controller.updateSettings(settings({ enabled: false }));
    answer({ verdicts: items.map(item => verdict(item.id)) });
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
    history.pushState({}, '', '/account/private');
    controller.updateSettings(settings());
    await vi.advanceTimersByTimeAsync(1200);
    expect(controller.pageStats.status).toBe('paused');
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
  });

  it('fails open, surfaces an error and avoids repeatedly retrying an unavailable service', async () => {
    const runtime = bridge(settings(), async () => { throw new Error('The service is unavailable.'); });
    const controller = await start(runtime);
    expect(controller.pageStats.status).toBe('error');
    expect(controller.pageStats.error).toContain('unavailable');
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
    document.body.insertAdjacentHTML('beforeend', card('More unassessed content is still readable', 1));
    await vi.advanceTimersByTimeAsync(2000);
    controller.scan();
    expect(runtime.send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(1);
  });

  it('leaves malformed and missing verdicts visible', async () => {
    const runtime = bridge(settings(), async () => ({ verdicts: [] }));
    const controller = await start(runtime);
    expect(controller.pageStats.status).toBe('error');
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
  });

  it('reports incomplete evidence even when the service returns an uncertain verdict for that item', async () => {
    const runtime = bridge(settings(), async items => ({ verdicts: items.map(item => verdict(item.id, { category: 'uncertain' })), errors: items.map(item => ({ id: item.id, message: 'The destination could not be inspected.' })) }));
    const controller = await start(runtime);
    expect(controller.pageStats.status).toBe('error');
    expect(controller.pageStats.error).toContain('destination');
    expect(controller.pageStats.scanned).toBe(1);
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
  });

  it('times out a disconnected detector and keeps the original page usable', async () => {
    const runtime = bridge(settings(), () => new Promise(() => {}));
    const controller = await start(runtime);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(controller.pageStats.status).toBe('error');
    expect(controller.pageStats.error).toContain('timed out');
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
    expect(runtime.send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(1);
  });

  it('ignores a response if its card changed before the debounced rescan runs', async () => {
    let answer!: (value: unknown) => void;
    let originalItems: ContentItem[] = [];
    let calls = 0;
    const runtime = bridge(settings(), items => {
      if (++calls === 1) { originalItems = items; return new Promise(resolve => { answer = resolve; }); }
      return Promise.resolve({ verdicts: items.map(item => verdict(item.id, { category: 'quality' })) });
    });
    await start(runtime);
    document.querySelector('a')!.textContent = 'A new original researched video replaces the previous result';
    await Promise.resolve(); // Deliver MutationObserver before the old verdict arrives.
    answer({ verdicts: originalItems.map(item => verdict(item.id)) });
    await vi.advanceTimersByTimeAsync(20);
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toBe(2);
    expect(document.querySelector('[data-no-slop-root]')).toBeNull();
  });

  it('covers newly inserted controls without reanalyzing an unchanged title', async () => {
    const runtime = bridge();
    await start(runtime);
    const element = document.querySelector('ytd-video-renderer')!;
    const button = document.createElement('button');
    button.textContent = 'New menu action';
    element.append(button);
    await vi.advanceTimersByTimeAsync(500);
    expect(button.hasAttribute('inert')).toBe(true);
    expect(runtime.send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(1);
  });

  it('keeps a focused card readable if the user focuses it while detection is pending', async () => {
    let answer!: (value: unknown) => void;
    let items: ContentItem[] = [];
    const runtime = bridge(settings({ mode: 'hide' }), batch => { items = batch; return new Promise(resolve => { answer = resolve; }); });
    await start(runtime);
    const anchor = document.querySelector('a')!;
    anchor.focus();
    answer({ verdicts: items.map(item => verdict(item.id)) });
    await vi.advanceTimersByTimeAsync(50);
    expect((document.querySelector('ytd-video-renderer') as HTMLElement).style.display).not.toBe('none');
    expect(anchor.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  it('skips far-offscreen cards until scrolling brings them near the viewport', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    let offscreen = true;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.matches('ytd-video-renderer')) return { top: offscreen ? 5000 : 200, bottom: offscreen ? 5200 : 400, height: 200, width: 300, x: 0, y: 0, left: 0, right: 300, toJSON: () => ({}) };
      return originalRect.call(this);
    });
    const runtime = bridge();
    await start(runtime);
    expect(runtime.send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(0);
    offscreen = false;
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(500);
    expect(runtime.send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(1);
  });
});

describe('automatic deferred analysis recovery', () => {
  it('resumes without scrolling or pressing Scan again and counts the item once', async () => {
    let attempts = 0;
    const runtime = bridge(settings(), async items => ++attempts <= 3
      ? { status:'deferred', reason:'rate-limit', retryAfterMs:1000 }
      : { verdicts:items.map(item=>verdict(item.id)) });
    const controller = await start(runtime);
    expect(controller.pageStats.status).toBe('waiting');
    expect(controller.pageStats.error).toBeUndefined();
    expect(controller.pageStats.scanned).toBe(0);
    await vi.advanceTimersByTimeAsync(900);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(attempts).toBe(4);
    expect(controller.pageStats).toMatchObject({status:'ready',scanned:1,filtered:1});
  });

  it('re-extracts recycled content instead of applying a stale deferred decision', async () => {
    const analyzed: ContentItem[][] = [];
    const runtime = bridge(settings(), async items => {
      analyzed.push(items);
      return analyzed.length === 1 ? {status:'deferred',reason:'pacing',retryAfterMs:1000}
        : {verdicts:items.map(item=>verdict(item.id,{category:'quality'}))};
    });
    const controller = await start(runtime);
    const title = document.querySelector('#video-title')!;
    title.textContent = 'A different careful tutorial that arrived while waiting';
    title.setAttribute('href','/watch?v=zyxwvutsrqp');
    await vi.advanceTimersByTimeAsync(1200);
    expect(analyzed).toHaveLength(2);
    expect(analyzed[1][0].title).toContain('different careful tutorial');
    expect(controller.pageStats).toMatchObject({scanned:1,filtered:0,status:'ready'});
  });

  it.each(['pause','revoke','restore','dispose'] as const)('cancels a scheduled retry on %s', async action => {
    let attempts = 0;
    const runtime = bridge(settings(), async () => {
      attempts++;
      return {status:'deferred',reason:'rate-limit',retryAfterMs:1000};
    });
    const controller = await start(runtime);
    if (action === 'pause') controller.updateSettings(settings({enabled:false}));
    if (action === 'revoke') controller.updateSettings(settings({consent:false}));
    if (action === 'restore') controller.restorePage();
    if (action === 'dispose') controller.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toBe(1);
  });

  it('does not retry content that has scrolled away during the cooldown', async () => {
    let attempts = 0;
    const controller = await start(bridge(settings(), async () => {
      attempts++;
      return {status:'deferred',reason:'pacing',retryAfterMs:1000};
    }));
    const element = document.querySelector('ytd-video-renderer')!;
    vi.spyOn(element,'getBoundingClientRect').mockReturnValue({top:3000,bottom:3100,height:100,left:0,right:500,width:500,x:0,y:3000,toJSON:()=>({})});
    await vi.advanceTimersByTimeAsync(2000);
    expect(attempts).toBe(1);
    expect(controller.pageStats.filtered).toBe(0);
    expect(controller.pageStats.status).toBe('ready');
  });
});
