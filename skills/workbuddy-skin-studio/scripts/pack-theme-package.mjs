#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainError, parseArgs, readJson, safePackagePath, walkFiles, fail, packZipStore } from './package-utils.mjs';

const self = fileURLToPath(new URL('./validate-theme-package.mjs', import.meta.url));
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }

const EMBEDDED_PAYLOAD = 'Contents/Resources/workbuddy-skin-package';
const MACOS_APPS = [
  'launchers/macos/Apply WorkBuddy Theme.app',
  'launchers/macos/Restore WorkBuddy Theme.app',
];

async function buildEmbeddedMacosPayload(packageDir, manifest) {
  const appPrefixes = MACOS_APPS.map((app) => `${app}/${EMBEDDED_PAYLOAD}/`);
  manifest.files = manifest.files.filter((file) => !appPrefixes.some((prefix) => file.startsWith(prefix)));
  if (!manifest.targetPlatforms.includes('macos')) {
    for (const app of MACOS_APPS) await rm(join(packageDir, app, EMBEDDED_PAYLOAD), { recursive: true, force: true });
    return [];
  }

  const allFiles = await walkFiles(packageDir);
  const payloadFiles = allFiles
    .map((item) => item.rel)
    .filter((file) => file.startsWith('runtime/') || file.startsWith('targets/macos/') || file.startsWith('theme.codedrobe-theme/') || file === 'core-theme.codedrobe-theme')
    .sort();
  const embeddedFiles = [...payloadFiles, 'manifest.json', 'checksums.sha256'].sort();
  const added = [];

  for (const app of MACOS_APPS) {
    const payloadRoot = join(packageDir, app, EMBEDDED_PAYLOAD);
    await rm(payloadRoot, { recursive: true, force: true });
    await mkdir(payloadRoot, { recursive: true });
    for (const file of payloadFiles) {
      const target = join(payloadRoot, file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(packageDir, file), target);
      if (file.endsWith('.command')) await chmod(target, 0o755);
    }
    const embeddedManifest = { ...manifest, launchers: {}, files: embeddedFiles };
    await writeFile(join(payloadRoot, 'manifest.json'), `${JSON.stringify(embeddedManifest, null, 2)}\n`, 'utf8');
    const checksumLines = [];
    for (const file of [...payloadFiles, 'manifest.json'].sort()) {
      checksumLines.push(`${sha256(await readFile(join(payloadRoot, file)))}  ${file}`);
    }
    await writeFile(join(payloadRoot, 'checksums.sha256'), `${checksumLines.join('\n')}\n`, 'utf8');
    for (const file of embeddedFiles) added.push(`${app}/${EMBEDDED_PAYLOAD}/${file}`);
  }
  manifest.files = [...new Set([...manifest.files, ...added])].sort();
  return added;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (!args['package-dir'] || !args.output) fail('--package-dir and --output are required');
  const packageDir = resolve(args['package-dir']);
  const output = resolve(args.output);
  if (output.startsWith(`${packageDir}/`) || output === packageDir) fail('zip output must be outside package directory');
  const checksumsFile = resolve(args['checksums-file'] ?? join(dirname(output), 'SHA256SUMS.txt'));
  if (checksumsFile.startsWith(`${packageDir}/`) || checksumsFile === packageDir || checksumsFile === output) fail('checksums file must be outside package directory and zip output');
  const manifestPath = join(packageDir, 'manifest.json');
  const manifest = await readJson(manifestPath, 'manifest.json');
  const checksumName = 'checksums.sha256';
  await rm(join(packageDir, checksumName), { force: true });
  manifest.files = manifest.files.filter((file) => file !== checksumName);
  await buildEmbeddedMacosPayload(packageDir, manifest);
  manifest.files = [...new Set(manifest.files.map((file) => safePackagePath(file)))].sort();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const validation = execFileSync(process.execPath, [self, '--package-dir', packageDir], { encoding: 'utf8' });
  const first = JSON.parse(validation); if (!first.pass) fail('package validation failed');
  manifest.files = [...new Set([...manifest.files, checksumName])].sort();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const files = await walkFiles(packageDir);
  const lines = [];
  for (const item of files.sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (item.rel === checksumName) continue;
    lines.push(`${sha256(await readFile(item.absolute))}  ${item.rel}`);
  }
  await writeFile(join(packageDir, checksumName), `${lines.join('\n')}\n`, 'utf8');
  execFileSync(process.execPath, [self, '--package-dir', packageDir], { encoding: 'utf8' });
  try {
    execFileSync('zip', ['-qr', '-X', output, '.', '-x', '*.DS_Store', '-x', '*/.DS_Store'], { cwd: packageDir, stdio: 'pipe' });
  } catch (error) {
    const isMissingZip = error?.code === 'ENOENT' || /spawnSync .* ENOENT/i.test(String(error?.message ?? ''));
    if (!isMissingZip) throw error;
    // Fallback: Node-native store-only ZIP when the `zip` CLI is unavailable (e.g. stock Windows).
    const files = await walkFiles(packageDir);
    await packZipStore(files, output);
  }
  const zipHash = sha256(await readFile(output));
  const externalChecksum = `${output}.sha256`;
  await writeFile(externalChecksum, `${zipHash}  ${basename(output)}\n`, 'utf8');
  let existing = '';
  try { existing = await readFile(checksumsFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const relativeOutput = relative(process.cwd(), output).replaceAll('\\', '/');
  const checksumLabel = relativeOutput && !relativeOutput.startsWith('..') ? relativeOutput : basename(output);
  const outputName = basename(output);
  const kept = existing.split(/\r?\n/).filter((line) => {
    const fields = line.trim().split(/\s+/);
    const recordedPath = fields.at(-1)?.replaceAll('\\', '/');
    return line.trim() && basename(recordedPath ?? '') !== outputName;
  });
  kept.push(`${zipHash}  ${checksumLabel}`);
  await writeFile(checksumsFile, `${kept.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ pass: true, output, externalChecksum, checksumsFile, files: (await walkFiles(packageDir)).length }, null, 2));
} catch (error) { mainError(error); }
