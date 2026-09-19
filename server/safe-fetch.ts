import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, request } from 'undici';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { ServiceError } from './limits.js';

const FORBIDDEN_NAMES = /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/i;
const THUMBNAIL_HOSTS = ['i.ytimg.com', 'img.youtube.com', 'yt3.ggpht.com', 'scontent.cdninstagram.com', 'cdninstagram.com', 'fbcdn.net', 'pbs.twimg.com', 'p16-sign-va.tiktokcdn.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'redd.it', 'redditmedia.com'];

export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === 'unicast';
  } catch { return false; }
}

export function validatePublicUrl(input: string): URL {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== '80' && url.port !== '443')) throw new ServiceError('This URL cannot be inspected.', 400);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || FORBIDDEN_NAMES.test(host) || isIP(host.replace(/^\[|\]$/g, ''))) throw new ServiceError('Only public website hostnames can be inspected.', 400);
  url.hash = '';
  return url;
}

export function isAllowedThumbnail(input: string): boolean {
  try {
    const url = validatePublicUrl(input);
    return url.protocol === 'https:' && THUMBNAIL_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

type ResolvedAddress = { address: string; family: number };
export async function resolvePublicHost(host: string, resolver: (hostname: string) => Promise<ResolvedAddress[]> = hostname => lookup(hostname, { all: true, verbatim: true }), signal?: AbortSignal): Promise<ResolvedAddress> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let addresses: ResolvedAddress[];
  try {
    addresses = await Promise.race([
      resolver(host),
      new Promise<never>((_, reject) => {
        abort = () => reject(new ServiceError('Website lookup timed out.'));
        timer = setTimeout(abort, 3000); timer.unref();
        signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); }
  // Reject mixed public/private DNS answers as well as direct private answers.
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new ServiceError('This website resolves to a restricted network.', 400);
  return addresses[0];
}

export interface Download { bytes: Buffer; contentType: string; url: string }
export async function downloadPublic(input: string, kind: 'image' | 'html', parentSignal?: AbortSignal): Promise<Download> {
  let url = validatePublicUrl(input);
  const maxBytes = kind === 'image' ? 1_500_000 : 750_000;
  const signal = AbortSignal.any([AbortSignal.timeout(6000), ...(parentSignal ? [parentSignal] : [])]);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (kind === 'image' && !isAllowedThumbnail(url.href)) throw new ServiceError('Thumbnail host is not supported.', 400);
    signal.throwIfAborted();
    const pinned = await resolvePublicHost(url.hostname, undefined, signal);
    // Socket DNS is pinned to the address just validated. Host header and TLS SNI
    // remain the original hostname; rebinding cannot trigger another DNS lookup.
    const dispatcher = new Agent({ connect: { timeout: 4000, lookup: (_host, _options, callback) => callback(null, [pinned]) } });
    try {
      const response = await request(url, {
        method: 'GET', dispatcher, signal,
        headersTimeout: 5000, bodyTimeout: 5000,
        headers: { 'user-agent': 'NO-SLOP/0.1 (+public-content-quality-check)', accept: kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'text/html', 'accept-encoding': 'identity' },
      });
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.body.destroy();
        const location = response.headers.location;
        if (!location || redirects === 3) throw new ServiceError('Website redirects could not be inspected.');
        url = validatePublicUrl(new URL(Array.isArray(location) ? location[0] : location, url).href);
        continue;
      }
      const rawType = response.headers['content-type'];
      const contentType = (Array.isArray(rawType) ? rawType[0] : rawType || '').split(';')[0].toLowerCase();
      const allowed = kind === 'image' ? ['image/jpeg', 'image/png', 'image/webp'].includes(contentType) : ['text/html', 'application/xhtml+xml'].includes(contentType);
      if (response.statusCode !== 200 || !allowed || Number(response.headers['content-length'] || 0) > maxBytes || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        response.body.destroy(); throw new ServiceError('Website did not return supported public content.');
      }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > maxBytes) { response.body.destroy(); throw new ServiceError('Website content exceeds the inspection limit.'); }
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      if (kind === 'image' && !hasImageSignature(bytes, contentType)) throw new ServiceError('Thumbnail did not contain a supported image.');
      return { bytes, contentType, url: url.href };
    } finally { await dispatcher.destroy(); }
  }
  throw new ServiceError('Website could not be inspected.');
}

export function hasImageSignature(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

export function extractDestination(html: string): { title: string; description: string; text: string } {
  const { document } = parseHTML(html);
  const title = (document.querySelector('title')?.textContent || '').trim().slice(0, 600);
  const description = (document.querySelector('meta[name="description"]')?.getAttribute('content') || '').slice(0, 1000);
  for (const node of document.querySelectorAll('script,style,noscript,nav,header,footer,form,input,textarea,select,button,[hidden],[aria-hidden="true"]')) node.remove();
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  let articleText = '';
  try {
    // Many real search destinations use div-based WordPress layouts. Selecting
    // body alone would send menus and marketing before the useful article.
    // Readability mutates its document, so retain a sanitized fallback copy.
    const article = new Readability(document.cloneNode(true) as Document, {
      maxElemsToParse: 12000, charThreshold: 200, disableJSONLD: true,
    }).parse();
    articleText = normalize(article?.textContent || '');
  } catch { /* Huge/unsupported DOMs still get a bounded semantic-text fallback. */ }
  const root = document.querySelector('main,article,[role="main"],.entry-content,.post-content,.article-content') || document.body;
  // Keep short spam/doorway pages assessable even when they lack an article.
  const text = (articleText.length >= 200 ? articleText : normalize(root?.textContent || '')).slice(0, 10000);
  if (!text && !title) throw new ServiceError('This website has no readable public text.');
  return { title, description, text };
}
