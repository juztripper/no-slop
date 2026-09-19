export function normalizeEndpoint(value: string): string {
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
    throw new Error('Use an HTTPS service address, or HTTP on localhost.');
  }
  return url.href.replace(/\/$/, '');
}

export function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^\*\./, '');
  if (!trimmed || /[\s/@?#:]/.test(trimmed)) throw new Error('Enter a domain such as example.com.');
  const host = new URL(`https://${trimmed}`).hostname.replace(/\.$/, '');
  if (!host || host.length > 253) throw new Error('Invalid domain.');
  return host;
}

/** Strip ordinary queries. Google opaque destination tokens are optional inspection metadata. */
export function publicContentUrl(value: string | undefined, allowOpaqueGoogleRedirect = true, depth = 0): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    url.hash = '';
    const videoId = /(^|\.)youtube\.com$/.test(url.hostname) ? url.searchParams.get('v') : null;
    const googleRedirect = /(^|\.)google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(url.hostname) && ['/goto','/url'].includes(url.pathname)
      ? url.searchParams.get('url') || url.searchParams.get('q') : null;
    url.search = '';
    if (videoId && /^[\w-]{6,20}$/.test(videoId)) url.searchParams.set('v', videoId);
    if (googleRedirect) {
      if (googleRedirect.length > 1500 || depth >= 2) return undefined;
      if (url.pathname === '/goto' && /^[A-Za-z0-9_-]+$/.test(googleRedirect)) {
        if (!allowOpaqueGoogleRedirect) return undefined;
        url.searchParams.set('url', googleRedirect);
        return url.href;
      }
      return publicContentUrl(googleRedirect, allowOpaqueGoogleRedirect, depth + 1);
    }
    return url.href;
  } catch { return undefined; }
}

export function isSensitivePage(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return true;
    const host = url.hostname.toLowerCase();
    if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || !host.includes('.')) return true;
    if (/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(host)) return true;
    const carrier = host.match(/^100\.(\d+)\./);
    if (carrier && Number(carrier[1]) >= 64 && Number(carrier[1]) <= 127) return true;
    if (/(^|\.)(mail\.google\.com|outlook\.(live|office)\.com|slack\.com|discord\.com|web\.whatsapp\.com|web\.telegram\.org|accounts\.google\.com)$/.test(host)) return true;
    let pathname = url.pathname;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const decoded = decodeURIComponent(pathname); if (decoded === pathname) break; pathname = decoded; } catch { return true; }
    }
    return /(?:^|\/)(?:messages?|messaging|inbox|direct|chats?|mail|compose|account|settings|login|signin|checkout|banking|billing|password|admin)(?:\/|$)/i.test(pathname);
  } catch { return true; }
}
