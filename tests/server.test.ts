import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { readConfig } from '../server/config';
const body = { items: [{ id: 'a', platform: 'forum', kind: 'post', title: 'Test', text: 'A useful post.' }], inspectThumbnails: false, inspectDestinations: false };
const detector = () => ({ analyze: vi.fn().mockResolvedValue({ verdicts: [], errors: [] }) });
describe('detector HTTP service', () => {
  it('validates bounded items and unique IDs before model work', async () => {
    const model = detector(); const app = await createApp(readConfig({ OPENROUTER_API_KEY: 'test', BUDGET_FILE: '' }), model);
    for (const payload of [{ ...body, items: Array(9).fill(body.items[0]) }, { ...body, items: [body.items[0], body.items[0]] }, { ...body, surprise: 'no' }]) {
      expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload })).statusCode).toBe(400);
    }
    expect(model.analyze).not.toHaveBeenCalled(); await app.close();
  });
  it('rejects website origins even on the local service', async () => {
    const app = await createApp(readConfig({ OPENROUTER_API_KEY: 'test', BUDGET_FILE: '' }), detector());
    const response = await app.inject({ method: 'POST', url: '/v1/analyze', headers: { origin: 'https://malicious.example' }, payload: body });
    expect(response.statusCode).toBe(403); await app.close();
  });
  it('accepts local unpacked extensions but hosted deployments require explicit origins', async () => {
    const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const local = await createApp(readConfig({ OPENROUTER_API_KEY: 'test', BUDGET_FILE: '' }), detector());
    expect((await local.inject({ method: 'POST', url: '/v1/analyze', headers: { origin }, payload: body })).statusCode).toBe(200); await local.close();
    const hosted = await createApp(readConfig({ OPENROUTER_API_KEY: 'test', HOST: '0.0.0.0', BUDGET_FILE: '' }), detector());
    expect((await hosted.inject({ method: 'POST', url: '/v1/analyze', headers: { origin }, payload: body })).statusCode).toBe(403); await hosted.close();
  });
  it('enforces hosted service tokens independently of CORS', async () => {
    const app = await createApp(readConfig({ OPENROUTER_API_KEY: 'test', SERVICE_TOKEN: 'test-token', BUDGET_FILE: '' }), detector());
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload: body })).statusCode).toBe(401);
    const success = await app.inject({ method: 'POST', url: '/v1/analyze', payload: body, headers: { authorization: 'Bearer test-token' } });
    expect(success.statusCode).toBe(200); expect(success.headers['cache-control']).toBe('no-store'); await app.close();
  });
  it('reports missing configuration without exposing environment values', async () => {
    const app = await createApp(readConfig({ BUDGET_FILE: '' }), detector());
    const health = await app.inject('/health'); expect(health.statusCode).toBe(503); expect(health.json().status).toBe('unconfigured');
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload: body })).statusCode).toBe(503); await app.close();
  });
  it('enforces per-IP rate limits and ignores untrusted forwarded IP headers', async () => {
    const app = await createApp(readConfig({ OPENROUTER_API_KEY: 'test', RATE_LIMIT_PER_MINUTE: '1', BUDGET_FILE: '' }), detector());
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload: body, headers: { 'x-forwarded-for': '1.1.1.1' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/analyze', payload: body, headers: { 'x-forwarded-for': '2.2.2.2' } })).statusCode).toBe(429); await app.close();
  });
});
