import { readConfig } from './config.js';
import { createApp } from './app.js';

const config = readConfig();
const app = await createApp(config);
await app.listen({ host: config.host, port: config.port });
console.info(`NO SLOP detector listening on ${config.host}:${config.port}`);
if (!config.apiKey) console.info('Set OPENROUTER_API_KEY to enable detection.');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
