import { describe, expect, it } from 'vitest';
import { extractDestination, hasImageSignature, isAllowedThumbnail, isPublicAddress, resolvePublicHost, validatePublicUrl } from '../server/safe-fetch';
describe('SSRF-safe public fetching', () => {
  it.each(['127.0.0.1', '10.0.0.2', '172.16.0.1', '192.168.1.2', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])('rejects non-public address %s', address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(['http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://localhost', 'http://secret.internal/path', 'https://user:password@example.com', 'https://example.com:8080', 'file:///etc/passwd'])('rejects unsafe URL %s', url => {
    expect(() => validatePublicUrl(url)).toThrow();
  });
  it('rejects mixed public and private DNS answers', async () => {
    await expect(resolvePublicHost('example.com', async () => [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.1', family: 4 }])).rejects.toThrow('restricted network');
    await expect(resolvePublicHost('example.com', async () => [{ address: '93.184.215.14', family: 4 }])).resolves.toMatchObject({ address: '93.184.215.14' });
  });
  it('matches thumbnail domain boundaries and requires HTTPS', () => {
    expect(isAllowedThumbnail('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe(true);
    expect(isAllowedThumbnail('https://i.ytimg.com.evil.example/x.jpg')).toBe(false);
    expect(isAllowedThumbnail('https://evili.ytimg.com/x.jpg')).toBe(false);
    expect(isAllowedThumbnail('http://i.ytimg.com/x.jpg')).toBe(false);
  });
  it('rejects content masquerading as an image', () => {
    expect(hasImageSignature(Buffer.from('<html>not an image'), 'image/jpeg')).toBe(false);
    expect(hasImageSignature(Buffer.from([255,216,255,224]), 'image/jpeg')).toBe(true);
  });
  it('extracts bounded public text without scripts, forms or hidden data', () => {
    const result = extractDestination('<html><head><title>Example</title></head><body><script>secret-script</script><nav>Navigation</nav><main>Useful tutorial.<form>private-form</form><div hidden>hidden-secret</div></main></body></html>');
    expect(result).toEqual({ title: 'Example', description: '', text: 'Useful tutorial.' });
  });
  it('extracts a div-based WordPress article ahead of bulky navigation and promotions', () => {
    const navigation = Array.from({ length: 60 }, (_, index) => `<li><a href="/catalog/${index}">Moisture meters and tools for professional flooring contractors ${index}</a></li>`).join('');
    const paragraph = 'A mortise and tenon joint connects two pieces of timber. Cut the mortise across the grain with a sharp chisel, check the fit, and leave enough wood around the opening. Glue both mating surfaces before clamping. ';
    const result = extractDestination(`<html><head><title>Woodworking joints</title></head><body><div class="menu-container"><ul>${navigation}</ul></div><div id="primary"><div class="entry-content"><h1>Making a strong timber joint</h1><p>${paragraph.repeat(3)}</p><p>${paragraph.repeat(2)}</p></div></div><div class="sidebar"><a href="/sale">Shop our latest promotional offers</a></div></body></html>`);
    expect(result.text).toContain('mortise and tenon');
    expect(result.text).not.toContain('professional flooring contractors');
    expect(result.text).not.toContain('latest promotional offers');
    expect(result.text.length).toBeLessThanOrEqual(10000);
  });
  it('retains a short keyword-stuffed doorway when no article is readable', () => {
    const result = extractDestination('<html><head><title>Best plumber</title></head><body><div>Best plumber cheap plumber near me. NEXT NEXT NEXT. Download our toolbar to continue.</div></body></html>');
    expect(result.text).toBe('Best plumber cheap plumber near me. NEXT NEXT NEXT. Download our toolbar to continue.');
  });
});
