import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AnalyzeRequestSchema } from '../src/shared/contracts.js';
import { readConfig, type Config } from './config.js';
import { Detector } from './detector.js';

export function originAllowed(origin: string | undefined, config: Config): boolean {
  if (!origin) return true; // CLI/server clients must still pass token and quotas.
  if (config.allowedOrigins.includes(origin)) return true;
  // Unpacked extensions get a fresh ID; permissive extension origins are local-only.
  return ['127.0.0.1', 'localhost', '::1'].includes(config.host) && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}
function tokenMatches(received: string | undefined, expected: string): boolean {
  if (!expected) return true;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(received || ''), hash(`Bearer ${expected}`));
}

export async function createApp(config = readConfig(), detector: Pick<Detector, 'analyze'> = new Detector(config)) {
  const app = Fastify({ logger: false, bodyLimit: 100_000, requestTimeout: 90_000, connectionTimeout: 10_000, trustProxy: config.trustProxy });
  await app.register(cors, { origin: (origin, callback) => callback(null, originAllowed(origin, config)), methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 600 });
  await app.register(rateLimit, { max: config.rateLimit, timeWindow: 60_000, cache: 5000, skipOnError: false });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (!originAllowed(request.headers.origin, config)) return reply.code(403).send({ error: 'Origin is not allowed.' });
    if (request.method !== 'OPTIONS' && request.url.startsWith('/v1/') && !tokenMatches(request.headers.authorization, config.serviceToken)) return reply.code(401).send({ error: 'A valid service token is required.' });
  });
  app.get('/health', async (_request, reply) => {
    if (!config.apiKey) return reply.code(503).send({ status: 'unconfigured', version: '0.1.0', model: config.jevModel });
    return { status: 'ok', version: '0.1.0', model: config.jevModel, capabilities: { text: true, thumbnails: false, destinations: true } };
  });
  app.post('/v1/analyze', async (request, reply) => {
    const parsed = AnalyzeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid analysis request. Use 1–8 bounded content items.' });
    if (new Set(parsed.data.items.map(item => item.id)).size !== parsed.data.items.length) return reply.code(400).send({ error: 'Item IDs must be unique within a batch.' });
    if (!config.apiKey) return reply.code(503).send({ error: 'Detector API key is not configured.' });
    return detector.analyze(parsed.data.items, parsed.data);
  });
  app.setErrorHandler((error, _request, reply) => {
    const code = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    void reply.code(status).send({ error: status === 429 ? 'Too many requests. Please try again shortly.' : status === 413 ? 'Request is too large.' : status === 400 ? 'Invalid request.' : 'The detector could not complete this request.' });
  });
  return app;
}
