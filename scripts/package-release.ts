import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
const manifest = JSON.parse(await readFile(join(root, 'dist/manifest.json'), 'utf8')) as { version: string; manifest_version: number };
if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || manifest.version !== pkg.version || manifest.manifest_version !== 3) {
  throw new Error('Package and built Manifest V3 versions must match before packaging.');
}

const output = resolve(root, `artifacts/releases/v${pkg.version}`);
const archiveName = `no-slop-${pkg.version}-chromium.zip`;
const archivePath = join(output, archiveName);
const releaseNotes = await readFile(join(root, `docs/releases/${pkg.version}.md`), 'utf8');
const staging = await mkdtemp(join(tmpdir(), 'no-slop-release-'));
const allowedExtensions = new Set(['.js', '.css', '.html', '.json', '.svg', '.png', '.woff2', '.txt', '.md']);
const paths: string[] = [];

async function inspect(directory: string, prefix = ''): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name.startsWith('.') || entry.isSymbolicLink() || /^(?:node_modules|server|dev|release-video|artifacts)$/.test(entry.name)) {
      throw new Error(`Unexpected release entry: ${relative}`);
    }
    if (entry.isDirectory()) {
      await inspect(join(directory, entry.name), relative);
      continue;
    }
    if (!entry.isFile() || (entry.name !== 'LICENSE' && !allowedExtensions.has(extname(entry.name)))) {
      throw new Error(`Unexpected release file: ${relative}`);
    }
    const contents = await readFile(join(directory, entry.name));
    if (/(?:sk-or-v1-[a-f0-9]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i.test(contents.toString('utf8'))) {
      throw new Error(`Credential-shaped data found in release file: ${relative}`);
    }
    paths.push(relative);
  }
}

try {
  await cp(join(root, 'dist'), staging, { recursive: true });
  await cp(join(root, 'PRIVACY.md'), join(staging, 'PRIVACY.md'));
  await writeFile(join(staging, 'RELEASE_NOTES.md'), releaseNotes);
  await writeFile(join(staging, 'INSTALL.md'), `# NO SLOP ${pkg.version} — developer preview

1. Extract this ZIP into a permanent folder.
2. Open chrome://extensions or edge://extensions, enable Developer mode, choose Load unpacked, and select this folder. manifest.json must be at its root.
3. Open NO SLOP settings → Privacy & connection and choose OpenRouter. Create your own key at https://openrouter.ai/settings/keys and set a dollar spending limit there.
4. Paste the key into OpenRouter API key, choose Save connection, then Check connection. This checks authentication without a paid model request.
5. Choose a Daily request allowance (default 100, from 1 to 10,000; resets at midnight UTC). It is a request-count cap, not a dollar limit. Failed model requests can count.
6. Review the data-sharing notice, enable Allow content analysis, then enable filtering. Refresh tabs that were already open.

No Node.js, terminal or separate server is needed for this default setup. You pay OpenRouter for your own model usage. The project supplies no key or credits. Direct processing uses visible text, titles, captions, snippets and context; it does not fetch destination pages or images.

Read PRIVACY.md before enabling analysis. Your key is stored locally on this device in trusted extension storage, never Chrome Sync or content scripts. This is not an encrypted vault. Removing extension data resets its local request allowance; the OpenRouter key spending limit is the independent dollar protection.

Upgrading from 0.1.0? Existing installations keep self-hosted mode. Replace the files in the same folder, reload the extension and refresh feed tabs. To remove the server requirement, choose OpenRouter, save your own key, check it and consent again. Keep the old detector running until you switch.

Self-hosted detector remains an advanced option for public destination inspection and your own infrastructure. Its provider key stays in the server environment; its service token is a separate password. The source contains docs/DEPLOYMENT.md for that setup, CONTRIBUTING.md, and the verification record. Node.js 24+ is needed only for source development or the optional Node.js server.

This is an unpacked pre-release, not a browser-store package. Known layouts are supported; uncertain content and failed requests stay visible. Images and audio/video are not analyzed. See RELEASE_NOTES.md for changes and known limits.
`);
  await inspect(staging);
  for (const required of ['manifest.json', 'background.js', 'content.js', 'popup.html', 'options.html', 'LICENSE', 'INSTALL.md', 'PRIVACY.md', 'RELEASE_NOTES.md']) {
    if (!paths.includes(required)) throw new Error(`Missing required release file: ${required}`);
  }
  await mkdir(output, { recursive: true });
  await rm(archivePath, { force: true });
  const compressed = spawnSync('zip', ['-X', '-q', archivePath, ...paths.sort()], { cwd: staging, encoding: 'utf8' });
  if (compressed.error || compressed.status !== 0) throw new Error('Could not create release ZIP. Install the zip command and retry.');
  const archive = await readFile(archivePath);
  const digest = createHash('sha256').update(archive).digest('hex');
  await writeFile(join(output, 'SHA256SUMS'), `${digest}  ${archiveName}\n`);
  await writeFile(join(output, 'RELEASE_NOTES.md'), releaseNotes);
  console.log(`Release package: ${archivePath}`);
  console.log(`${paths.length} reviewed files; ${archive.length} bytes; SHA-256 ${digest}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
