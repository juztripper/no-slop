import type { ContentItem, Platform } from '../shared/contracts';
import { isSensitivePage, publicContentUrl } from '../shared/security';

export interface Candidate {
  element: HTMLElement;
  item: ContentItem;
  /** A discussion with replies, or a paragraph, must retain its surrounding meaning. */
  preserveContext: boolean;
  fingerprint: string;
}

const OWN = '[data-no-slop-root]';
const PRIVATE = 'form,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog,[aria-modal="true"],[data-no-slop-ignore]';
const OMIT = `${OWN},script,style,noscript,template,nav,button,[aria-hidden="true"],${PRIVATE}`;
const COMMENT = 'shreddit-comment,[data-testid="comment"],ytd-comment-thread-renderer,ytd-comment-view-model,ytd-comment-renderer,[data-e2e="comment-item"],[data-e2e="comment-level-1"],[data-e2e="comment-level-2"],.topic-post,article.message,.comment-body';

export function platformForUrl(url: URL, doc?: Document): Platform {
  const host = url.hostname.toLowerCase();
  const is = (base: string) => host === base || host.endsWith(`.${base}`);
  if (is('youtube.com')) return 'youtube';
  if (/^(?:www\.|m\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host)) return 'google';
  if (is('instagram.com')) return 'instagram';
  if (is('facebook.com')) return 'facebook';
  if (is('tiktok.com')) return 'tiktok';
  if (is('x.com') || is('twitter.com')) return 'x';
  if (is('reddit.com')) return 'reddit';
  if (doc?.querySelector('#discourse-root,.topic-post,article.message,.phpbb,.ipsComment,ol.comment-list,ul.comment-list')) return 'forum';
  return 'generic';
}

/** Defense in depth: never transmit content from recognizable private surfaces. */
export function isPrivatePage(url: URL): boolean {
  if (isSensitivePage(url.href)) return true;
  if (/^(?:mail|calendar|contacts|docs|drive|meet)\./i.test(url.hostname)) return true;
  if (/(?:^|\.)(?:outlook\.live\.com|outlook\.office\.com|web\.whatsapp\.com|web\.telegram\.org|discord\.com|slack\.com)$/.test(url.hostname)) return true;
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); } catch { /* Keep malformed paths opaque. */ }
  return /(?:^|\/)(?:messages?|messaging|direct|inbox|chats?|conversations?|settings|accounts?|login|signin|sign-in|checkout|compose|mail|oauth|auth)(?:\/|$)/i.test(pathname);
}

function cleanText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(OMIT).forEach(node => node.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function safeUrl(value: string | null | undefined, base: URL): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    url.hash = '';
    // Tracking does not help the detector and can carry per-user identifiers.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|si$|feature$|ref$|ref_|s$)/i.test(key)) url.searchParams.delete(key);
    }
    const result = url.href;
    return result.length <= 2000 ? result : undefined;
  } catch { return; }
}

function publicLink(element: HTMLElement, platform: Platform, page: URL): string | undefined {
  const selectors: Partial<Record<Platform, string>> = {
    youtube: 'a[href*="/watch?"],a[href*="/shorts/"],a[href*="/post/"]',
    google: 'a:has(h3)', x: 'a[href*="/status/"]', instagram: 'a[href*="/p/"],a[href*="/reel/"]',
    reddit: 'a[slot="full-post-link"],a[href*="/comments/"]',
    tiktok: 'a[href*="/video/"]', facebook: 'a[href*="/posts/"],a[href*="/videos/"],a[href*="/permalink/"]',
  };
  const link = element.querySelector<HTMLAnchorElement>(selectors[platform] ?? 'h2 a,h3 a,a[rel="bookmark"],a');
  let href = link?.getAttribute('href') ?? element.getAttribute('content-href') ?? element.getAttribute('permalink');
  if (platform === 'google' && href?.startsWith('/url?')) {
    href = new URL(href, page).searchParams.get('q') ?? new URL(href, page).searchParams.get('url');
  }
  return publicContentUrl(safeUrl(href, page));
}

function fingerprint(value: string): string {
  let first = 2166136261;
  let second = 5381;
  for (let i = 0; i < value.length; i++) {
    first = Math.imul(first ^ value.charCodeAt(i), 16777619);
    second = Math.imul(second, 33) ^ value.charCodeAt(i);
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

function draftPresent(element: HTMLElement): boolean {
  return [...element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].some(input =>
    input.type === 'password' || (!['checkbox', 'radio', 'hidden', 'submit', 'button', 'search'].includes(input.type) && !!input.value.trim()),
  ) || [...element.querySelectorAll('[contenteditable]:not([contenteditable="false"]),[role="textbox"]')].some(editor => !!editor.textContent?.trim());
}

export function isEligibleContentUnit(element: HTMLElement): boolean {
  return !element.matches('html,body,main,nav,header,footer,aside,section,ul,ol,[role="feed"],[role="main"]') &&
    !element.closest(`${OWN},${PRIVATE},nav,header,footer,aside,[role="navigation"]`) &&
    !element.hidden && element.getAttribute('aria-hidden') !== 'true' && !draftPresent(element);
}

function makeCandidate(element: HTMLElement, platform: Platform, page: URL, kind: ContentItem['kind']): Candidate | undefined {
  if (!isEligibleContentUnit(element)) return;
  let textElement: Element = element;
  if (kind === 'comment') textElement = element.querySelector('[id="content-text"],[data-testid="comment"],.cooked,.message-body,.comment-content,.comment-body,.content,[data-e2e="comment-level-1"]') ?? element;
  const titleElement = element.querySelector('[id="video-title"],[id="video-title-link"],h3,h2,[data-testid="post-title"],[slot="title"],[data-e2e="browse-video-desc"]');
  let title = element.getAttribute('post-title') ?? (titleElement ? cleanText(titleElement) : '');
  // Do not send reply threads as if their combined text belonged to the parent author.
  const clone = textElement.cloneNode(true) as Element;
  clone.querySelectorAll(COMMENT).forEach(reply => reply.remove());
  if (platform === 'facebook') clone.querySelectorAll('[role="article"]').forEach(reply => reply.remove());
  if (platform === 'instagram') clone.querySelectorAll('ul ul li').forEach(reply => { if (reply.querySelector('time')) reply.remove(); });
  let text = cleanText(clone);
  if (platform === 'youtube' && kind === 'video') {
    title = title || element.querySelector('a[title]')?.getAttribute('title') || '';
    const description = element.querySelector('.metadata-snippet-text,[id="description-text"]');
    text = [title, description ? cleanText(description) : ''].filter(Boolean).join(' — ');
  }
  if (!text && !title) return;
  if ((text.length + title.length) < 12) return;
  title = title.slice(0, 600);
  text = text.slice(0, 6000);
  const url = publicLink(element, platform, page);
  const image = element.querySelector<HTMLImageElement>('img[src],img[data-src]');
  let thumbnailUrl = kind !== 'comment' && (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram')
    ? safeUrl(image?.currentSrc || image?.getAttribute('src') || image?.getAttribute('data-src'), page) : undefined;
  // YouTube lazy thumbnails are sometimes transparent placeholders before visibility.
  if (!thumbnailUrl && platform === 'youtube' && kind === 'video' && url) {
    const parsed = new URL(url);
    const video = parsed.searchParams.get('v') ?? parsed.pathname.match(/^\/shorts\/([\w-]{11})/)?.[1];
    if (video && /^[\w-]{11}$/.test(video)) thumbnailUrl = `https://i.ytimg.com/vi/${video}/hqdefault.jpg`;
  }
  const context = kind === 'comment' ? cleanText(element.closest('[role="feed"],main')?.querySelector('h1') ?? element.ownerDocument.createElement('span')).slice(0, 300) : '';
  const key = fingerprint(JSON.stringify([platform, kind, title, text, url, thumbnailUrl, context]));
  return {
    element, fingerprint: key,
    item: { id: `ns-${key}`, platform, kind, title, text, ...(url ? { url } : {}), ...(thumbnailUrl ? { thumbnailUrl } : {}), ...(context ? { context } : {}) },
    preserveContext: kind === 'paragraph' || !!element.querySelector('shreddit-comment,[data-testid="comment"],[role="article"],ul ul,.replies,.children,ytd-comment-thread-renderer,ytd-comment-replies-renderer,.topic-post,article.message'),
  };
}

function youtubeUnits(doc: Document): {element: HTMLElement; kind: ContentItem['kind']}[] {
  const selector = 'ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,ytd-reel-item-renderer,yt-lockup-view-model,ytm-shorts-lockup-view-model,ytd-rich-grid-media,ytd-comment-thread-renderer,ytd-comment-view-model,ytd-comment-renderer,ytd-backstage-post-thread-renderer,ytd-post-renderer';
  return [...doc.querySelectorAll<HTMLElement>(selector)].filter(element => {
    if (element.matches('ytd-rich-item-renderer') && !element.querySelector('ytd-rich-grid-media,yt-lockup-view-model,ytd-rich-grid-slim-media,[id="video-title"]')) return false;
    const ancestor = element.parentElement?.closest(selector);
    if (!ancestor) return true;
    if (!element.matches('ytd-comment-thread-renderer,ytd-comment-view-model,ytd-comment-renderer')) return false;
    if (ancestor.matches('ytd-backstage-post-thread-renderer,ytd-post-renderer')) return true;
    return ancestor.matches('ytd-comment-thread-renderer') && !!element.closest('ytd-comment-replies-renderer');
  }).map(element => ({ element, kind: element.matches('ytd-comment-thread-renderer,ytd-comment-view-model,ytd-comment-renderer') ? 'comment' : element.matches('ytd-backstage-post-thread-renderer,ytd-post-renderer') ? 'post' : 'video' }));
}

function googleUnits(doc: Document): HTMLElement[] {
  const results = new Set<HTMLElement>();
  for (const heading of doc.querySelectorAll('#search h3,#rso h3')) {
    const result = heading.closest<HTMLElement>('.MjjYud,.g,.tF2Cxc,[data-sokoban-container]');
    if (!result || result.querySelectorAll('h3').length !== 1 || result.querySelector('nav,form,#rso,#search')) continue;
    results.add(result);
  }
  // Google can wrap one result in both .g and .MjjYud. The closest recognized unit wins.
  return [...results];
}

const SITE_SELECTORS: Partial<Record<Platform, string>> = {
  x: 'article[data-testid="tweet"]',
  instagram: 'article,ul ul li',
  facebook: '[role="article"]',
  tiktok: '[data-e2e="recommend-list-item-container"],[data-e2e="search_top-item"],[data-e2e="user-post-item"],[data-e2e="comment-item"],[data-e2e="comment-level-1"],[data-e2e="comment-level-2"]',
  reddit: 'shreddit-post,shreddit-comment,[data-testid="post-container"],[data-testid="comment"]',
  forum: '.topic-post,article.message,.ipsComment,li.comment,article.comment,.post[id^="p"]',
};

/** Query only recognized independent units; unknown layouts are deliberately left intact. */
export function extractCandidates(doc: Document, page: URL, annotateParagraphs = true, limit = 240, include: (element: HTMLElement) => boolean = () => true): Candidate[] {
  if (isPrivatePage(page)) return [];
  const platform = platformForUrl(page, doc);
  const units: { element: HTMLElement; kind: ContentItem['kind'] }[] = [];
  if (platform === 'youtube') units.push(...youtubeUnits(doc));
  else if (platform === 'google') units.push(...googleUnits(doc).map(element => ({ element, kind: 'search' as const })));
  else if (SITE_SELECTORS[platform]) {
    const selector = SITE_SELECTORS[platform]!;
    for (const element of doc.querySelectorAll<HTMLElement>(selector)) {
      // Instagram list markup is shared with menus; comment rows must have a timestamp.
      if (platform === 'instagram' && element.matches('li') && !element.querySelector('time')) continue;
      const isComment = element.matches(COMMENT) || platform === 'forum' || (platform === 'instagram' && element.matches('li')) || (platform === 'facebook' && !!element.parentElement?.closest('[role="article"]'));
      const ancestor = element.parentElement?.closest(selector);
      // Keep separate replies, but avoid nested wrappers representing the very same comment.
      if (ancestor && !isComment) continue;
      if (ancestor && element.matches('[data-e2e="comment-level-1"],[data-e2e="comment-level-2"]')) continue;
      units.push({ element, kind: isComment ? 'comment' : platform === 'tiktok' ? 'video' : 'post' });
    }
  } else {
    for (const element of doc.querySelectorAll<HTMLElement>('article,[role="article"],main li,[role="feed"] > div')) {
      if (element.querySelector('article,[role="article"],main,nav') || cleanText(element).length > 3500) continue;
      if (!element.matches('article,[role="article"]') && !element.querySelector('h2 a,h3 a,a[rel="bookmark"]')) continue;
      const articles = element.parentElement?.querySelectorAll(':scope > article,:scope > [role="article"]');
      if (element.matches('article') && (articles?.length ?? 0) < 2 && !element.closest('[role="feed"],li')) continue;
      units.push({ element, kind: 'post' });
    }
  }
  if (annotateParagraphs && (platform === 'generic' || platform === 'forum')) {
    for (const element of doc.querySelectorAll<HTMLElement>('main p,article p,[role="main"] p')) {
      const length = cleanText(element).length;
      if (length < 180 || length > 6000 || units.some(unit => unit.element.contains(element))) continue;
      units.push({ element, kind: 'paragraph' });
    }
  }
  const seen = new Set<HTMLElement>();
  const candidates: Candidate[] = [];
  for (const unit of units) {
    if (seen.has(unit.element) || !include(unit.element)) continue;
    seen.add(unit.element);
    const candidate = makeCandidate(unit.element, platform, page, unit.kind);
    if (candidate) candidates.push(candidate);
    if (candidates.length >= limit) break;
  }
  return candidates;
}
