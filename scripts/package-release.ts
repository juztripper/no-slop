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
  await writeFile(join(staging, 'INSTALL.md'), `# NO SLOP ${pkg.version} — developer preview

1. Extract this ZIP into a permanent folder.
2. Open chrome://extensions or edge://extensions, enable Developer mode, choose Load unpacked, and select this folder. manifest.json must be at its root.
3. Download or clone the matching project source release. Install Node.js 24+, then run npm ci in the source directory.
4. Copy .env.example to .env if it does not exist. Set your own OPENROUTER_API_KEY and a provider key spending limit. Never put this key in extension settings.
5. Run npm run server:dev and keep that terminal running.
6. In NO SLOP settings → Privacy & service, test http://localhost:8787, review the data flow, enable content analysis, and refresh existing tabs.

The ZIP contains the browser extension only. You run the detector and pay for provider usage through your own OpenRouter account. The project supplies no key, credits or hosted detector. The optional service token is a separate password for your detector, not an OpenRouter key.

Read PRIVACY.md before enabling analysis. Local hosting keeps your key on your computer; selected text still goes to OpenRouter and Jev. The source contains docs/DEPLOYMENT.md for Docker/remote setup and troubleshooting, CONTRIBUTING.md, and the full verification record.

This is a pre-release installed unpacked, not a browser-store package. After replacing its files, reload the extension and refresh feed tabs. Known site layouts are supported; uncertain content and detector failures stay visible. Images and audio/video are not analyzed.
`);
  await inspect(staging);
  for (const required of ['manifest.json', 'background.js', 'content.js', 'popup.html', 'options.html', 'LICENSE', 'INSTALL.md', 'PRIVACY.md']) {
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
