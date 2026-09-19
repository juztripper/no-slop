import { z } from 'zod';

const integer = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback);
const EnvironmentSchema = z.object({
  HOST: z.string().default('127.0.0.1'), PORT: integer(8787, 1, 65535),
  JEV_MODEL: z.string().min(1).default('~typesafe/jev-latest'),
  VISION_MODEL: z.string().min(1).default('google/gemini-2.5-flash-lite'),
  SERVICE_TOKEN: z.string().default(''), ALLOWED_ORIGINS: z.string().default(''),
  RATE_LIMIT_PER_MINUTE: integer(40, 1, 1000), MAX_CONCURRENT: integer(4, 1, 32),
  MAX_PENDING: integer(32, 1, 128), DAILY_CALL_BUDGET: integer(10000, 1, 1000000),
  CACHE_MAX_ENTRIES: integer(2000, 1, 10000), CACHE_TTL_SECONDS: integer(1800, 1, 86400),
  BUDGET_FILE: z.string().default('.data/budget.json'),
  TRUST_PROXY: z.string().default(''),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const values = EnvironmentSchema.parse(env);
  const legacyKey = env.OPENAI_API_KEY?.startsWith('sk-or-') ? env.OPENAI_API_KEY : undefined;
  return {
    host: values.HOST, port: values.PORT,
    apiKey: env.OPENROUTER_API_KEY || legacyKey || '',
    jevModel: values.JEV_MODEL, visionModel: values.VISION_MODEL,
    serviceToken: values.SERVICE_TOKEN,
    allowedOrigins: values.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean),
    rateLimit: values.RATE_LIMIT_PER_MINUTE, maxConcurrent: values.MAX_CONCURRENT,
    maxPending: values.MAX_PENDING, dailyCallBudget: values.DAILY_CALL_BUDGET,
    cacheEntries: values.CACHE_MAX_ENTRIES, cacheTtlMs: values.CACHE_TTL_SECONDS * 1000,
    budgetFile: values.BUDGET_FILE,
    // An explicit trusted proxy IP/CIDR list, never blindly trust client-forwarded IPs.
    trustProxy: values.TRUST_PROXY ? values.TRUST_PROXY.split(',').map(value => value.trim()) : false as false,
  };
}
export type Config = ReturnType<typeof readConfig>;
