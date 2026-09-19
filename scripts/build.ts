import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

await viteBuild();
await Promise.all([
  build({ entryPoints:['src/background/index.ts'], outfile:'dist/background.js', bundle:true, format:'esm', platform:'browser', target:'chrome116', minify:true }),
  build({ entryPoints:['src/content/index.ts'], outfile:'dist/content.js', bundle:true, format:'iife', platform:'browser', target:'chrome116', minify:true }),
]);
await mkdir('dist/icons', { recursive:true });
const icon = await readFile('public/brand/mark.svg');
await Promise.all([16,32,48,128].map(size => sharp(icon).resize(size,size).png().toFile(`dist/icons/${size}.png`)));
await copyFile('LICENSE', 'dist/LICENSE');
// Build-time tripwire: server credentials must never enter the distributable.
let secrets: string[] = [];
try {
  const environment = await readFile('.env','utf8');
  secrets = [...environment.matchAll(/^(?:export\s+)?[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*["']?([^\s"']+)/gm)].map(match => match[1]).filter(value => value.length > 12);
} catch { /* A public build needs no secrets. */ }
secrets.push(...Object.entries(process.env).filter(([name, value]) => /(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(name) && typeof value === 'string' && value.length > 12).map(([, value]) => value!));
async function inspectPackage(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    const path = join(directory,entry.name);
    if (entry.isDirectory()) { await inspectPackage(path); continue; }
    if (entry.name === '.env' || entry.name.startsWith('.env.')) throw new Error('Environment file found in extension output.');
    const output = await readFile(path);
    if (secrets.some(secret => output.includes(Buffer.from(secret)))) throw new Error(`Secret found in extension output: ${path}`);
  }
}
await inspectPackage('dist');
console.log('Extension ready in dist/ — load this folder as an unpacked extension.');
