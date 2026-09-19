import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn(), agents: [] as Array<{ options: { connect: { lookup: (...args: unknown[]) => void } }; destroy: ReturnType<typeof vi.fn> }> }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('undici', () => ({
  Agent: class {
    destroy = vi.fn().mockResolvedValue(undefined);
    constructor(public options: { connect: { lookup: (...args: unknown[]) => void } }) { mocks.agents.push(this); }
  },
  request: mocks.request,
}));
import { downloadPublic } from '../server/safe-fetch';
function response(statusCode: number, headers: Record<string, string>, content = '<html><body>Content</body></html>') {
  return { statusCode, headers, body: Readable.from([Buffer.from(content)]) };
}
beforeEach(() => { mocks.lookup.mockReset().mockResolvedValue([{ address: '93.184.215.14', family: 4 }]); mocks.request.mockReset(); mocks.agents.length = 0; });
describe('network transport safety', () => {
  it('pins the validated DNS address and sends GET without cookies or credentials', async () => {
    mocks.request.mockResolvedValue(response(200, { 'content-type': 'text/html' }));
    await downloadPublic('https://example.com/article', 'html');
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    const callback = vi.fn(); mocks.agents[0].options.connect.lookup('example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.215.14', family: 4 }]);
    const options = mocks.request.mock.calls[0][1];
    expect(options.method).toBe('GET'); expect(options.headers.cookie).toBeUndefined(); expect(options.headers.authorization).toBeUndefined();
    expect(mocks.agents[0].destroy).toHaveBeenCalledTimes(1);
  });
  it('rechecks every redirect and prevents a public-to-private redirect', async () => {
    mocks.request.mockResolvedValue(response(302, { location: 'http://169.254.169.254/latest/meta-data/' }));
    await expect(downloadPublic('https://example.com/article', 'html')).rejects.toThrow('public website hostnames');
    expect(mocks.request).toHaveBeenCalledTimes(1); expect(mocks.agents[0].destroy).toHaveBeenCalledTimes(1);
  });
  it('rejects redirected DNS rebinding before connecting to the second host', async () => {
    mocks.request.mockResolvedValue(response(302, { location: 'https://rebinding.example/article' }));
    mocks.lookup.mockResolvedValueOnce([{ address: '93.184.215.14', family: 4 }]).mockResolvedValueOnce([{ address: '10.0.0.2', family: 4 }]);
    await expect(downloadPublic('https://example.com/article', 'html')).rejects.toThrow('restricted network');
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('limits redirect chains and destroys each connection', async () => {
    mocks.request.mockImplementation(async () => response(302, { location: 'https://example.com/again' }));
    await expect(downloadPublic('https://example.com/article', 'html')).rejects.toThrow('redirects');
    expect(mocks.request).toHaveBeenCalledTimes(4); expect(mocks.agents.every(agent => agent.destroy.mock.calls.length === 1)).toBe(true);
  });
  it('rejects oversized streamed bodies even without content-length', async () => {
    mocks.request.mockResolvedValue(response(200, { 'content-type': 'text/html' }, 'x'.repeat(750001)));
    await expect(downloadPublic('https://example.com/article', 'html')).rejects.toThrow('inspection limit');
  });
  it('rejects compressed bodies instead of decompressing a potential bomb', async () => {
    mocks.request.mockResolvedValue(response(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }));
    await expect(downloadPublic('https://example.com/article', 'html')).rejects.toThrow('supported public content');
  });
  it('requires all image redirects to stay on the thumbnail allowlist', async () => {
    mocks.request.mockResolvedValue(response(302, { location: 'https://attacker.example/image.jpg' }));
    await expect(downloadPublic('https://i.ytimg.com/vi/x/hqdefault.jpg', 'image')).rejects.toThrow('Thumbnail host');
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
