#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertContained, assertSafeTree, readJsonFile } from './security.mjs';
import {
  CdpSession,
  applySkin,
  captureScreenshot,
  discoverApp,
  findTargets,
  findRunningPids,
  getAdapter,
  readThemePackage,
  resolveThemeTarget,
  restoreSkin,
  verifyTheme,
  watchTheme,
} from './vendor/codedrobe-core/src/index.mjs';

const CORE_VERSION = '0.6.1';
const STATE_FILE = 'runtime-state.json';
const MODES = new Set(['dry-run', 'apply', 'verify', 'restore', 'watch']);
const FLAG_ARGS = new Set(['restart', 'watch']);
const execFileAsync = promisify(execFile);

function fail(message) {
  throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`unsupported argument: ${token}`);
    const key = token.slice(2);
    if (!/^[a-z][a-z0-9-]*$/.test(key) || Object.hasOwn(args, key)) fail(`invalid argument: ${token}`);
    if (FLAG_ARGS.has(key)) {
      args[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`missing value for ${token}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0')) fail(`${label} is invalid`);
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) fail(`${label} must be relative`);
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail(`${label} contains traversal`);
  return parts.join('/');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('visual contract color is invalid');
  return value.toLowerCase();
}

function visualPalette(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('visual contract palette is invalid');
  return {
    background: color(value.background),
    text: color(value.text),
    accent: color(value.accent),
  };
}

function portFromEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint ?? 'http://127.0.0.1:9336');
  } catch {
    fail('CDP endpoint is invalid');
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || (url.pathname !== '/' && url.pathname !== '')) {
    fail('CDP must use http://127.0.0.1:<port>');
  }
  const port = Number(url.port || 80);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('CDP port is invalid');
  return port;
}

async function walkRegularFiles(root) {
  const files = [];
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) fail(`symbolic link rejected: ${rel}`);
      if (info.isDirectory()) await visit(absolute, rel);
      else if (info.isFile()) files.push({ rel, absolute });
      else fail(`unsupported package entry: ${rel}`);
    }
  }
  await visit(root);
  return files;
}

async function verifyChecksums(root, files) {
  const checksumFile = join(root, 'checksums.sha256');
  let source;
  try {
    source = await readFile(checksumFile, 'utf8');
  } catch {
    fail('checksums.sha256 is required for the Windows Core runtime');
  }
  const lines = source.split(/\r?\n/).filter(Boolean);
  const expected = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/i.exec(line);
    if (!match) fail('checksums.sha256 contains an invalid entry');
    const rel = safeRelativePath(match[2], 'checksum path');
    if (rel === 'checksums.sha256' || expected.has(rel.toLowerCase())) fail('checksums.sha256 contains a duplicate entry');
    expected.set(rel.toLowerCase(), { rel, digest: match[1].toLowerCase() });
  }
  const actual = files.filter((file) => file.rel !== 'checksums.sha256');
  if (expected.size !== actual.length) fail('checksums.sha256 does not cover the complete package');
  for (const file of actual) {
    const entry = expected.get(file.rel.toLowerCase());
    if (!entry || entry.rel !== file.rel) fail(`checksum entry missing: ${file.rel}`);
    const digest = sha256(await readFile(file.absolute));
    if (digest !== entry.digest) fail(`checksum mismatch: ${file.rel}`);
  }
  return sha256(source);
}

function assertManifestSecurity(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('manifest is invalid');
  if (manifest.schemaVersion !== 1 || manifest.application !== 'workbuddy' || manifest.runtimeVersion !== '1.0.0') {
    fail('unsupported WorkBuddy theme manifest');
  }
  if (manifest.coreRuntimeVersion !== CORE_VERSION || typeof manifest.coreThemePackage !== 'string') {
    fail(`Windows runtime requires bundled @codedrobe/core ${CORE_VERSION}`);
  }
  if (!Array.isArray(manifest.targetPlatforms) || !manifest.targetPlatforms.includes('windows')) fail('package does not target Windows');
  if (manifest.requiresUserRestartConfirmation !== true) fail('package is missing restart confirmation policy');
  const security = manifest.security;
  if (!security || security.allowRemoteResources !== false || security.allowAppAsarWrites !== false || security.allowUserPaths !== false || security.allowSecrets !== false || security.declarationOnlyTheme !== true) {
    fail('package security policy is unsafe');
  }
  if (!manifest.visualContract || typeof manifest.visualContract !== 'object' || Array.isArray(manifest.visualContract)) fail('visual contract is missing');
  const visualContract = visualPalette(manifest.visualContract);
  if (Object.hasOwn(manifest.visualContract, 'modes')) {
    const modes = manifest.visualContract.modes;
    if (!modes || typeof modes !== 'object' || Array.isArray(modes)) fail('visual contract modes are invalid');
    visualContract.modes = {
      dark: visualPalette(modes.dark),
      light: visualPalette(modes.light),
    };
  }
  if (typeof manifest.themeId !== 'string' || !manifest.themeId.trim()) fail('manifest themeId is invalid');
  if (!Array.isArray(manifest.files)) fail('manifest file list is missing');
  return visualContract;
}

async function loadPackage(packageArgument) {
  const root = resolve(packageArgument ?? process.cwd());
  await assertSafeTree(root);
  const files = await walkRegularFiles(root);
  const manifest = await readJsonFile(join(root, 'manifest.json'), 'manifest.json');
  const visualContract = assertManifestSecurity(manifest);
  const declared = new Map();
  for (const item of manifest.files) {
    const rel = safeRelativePath(item, 'manifest file');
    const key = rel.toLowerCase();
    if (declared.has(key)) fail(`duplicate manifest file: ${rel}`);
    declared.set(key, rel);
  }
  if (declared.size !== files.length) fail('manifest file list does not match package contents');
  for (const file of files) {
    if (declared.get(file.rel.toLowerCase()) !== file.rel) fail(`undeclared package file: ${file.rel}`);
    assertContained(root, file.absolute, `manifest file ${file.rel}`);
  }
  const checksumDigest = await verifyChecksums(root, files);
  const coreThemeRelative = safeRelativePath(manifest.coreThemePackage, 'Core theme package');
  if (!coreThemeRelative.endsWith('.codedrobe-theme')) fail('Core theme package extension is invalid');
  const coreThemePath = join(root, coreThemeRelative);
  const bundle = await readThemePackage(coreThemePath);
  if (bundle.theme.id !== manifest.themeId || bundle.theme.version !== manifest.version || bundle.theme.displayName !== manifest.displayName) {
    fail('Core theme identity does not match manifest');
  }
  const targetTheme = resolveThemeTarget(bundle, 'workbuddy');
  for (const requiredCssToken of ['--cb-bg-primary', '--cb-vscode-editor-background', '--cb-text-primary', '--cb-button-dark-background', 'var(--codedrobe-art)']) {
    if (!targetTheme.css.includes(requiredCssToken)) fail(`Core theme CSS is missing ${requiredCssToken}`);
  }
  const corePackage = await readJsonFile(join(root, 'runtime', 'vendor', 'codedrobe-core', 'package.json'), 'bundled Core package.json');
  if (corePackage.name !== '@codedrobe/core' || corePackage.version !== CORE_VERSION) fail(`bundled Core must be exactly ${CORE_VERSION}`);
  return { root, manifest, targetTheme, visualContract, checksumDigest };
}

function defaultStateDirectory(packageRoot) {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(localAppData, 'WorkBuddy', 'Skin Studio', sha256(packageRoot).slice(0, 24));
}

function skinStateRoot() {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(localAppData, 'WorkBuddy', 'Skin Studio');
}

async function readState(stateDir) {
  try {
    return JSON.parse(await readFile(join(stateDir, STATE_FILE), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    fail(`runtime state is invalid: ${error.message}`);
  }
}

async function saveState(stateDir, state) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function packageState(packageInfo, status, extra = {}) {
  return {
    schemaVersion: 1,
    status,
    packageDir: packageInfo.root,
    packageChecksum: packageInfo.checksumDigest,
    themeId: packageInfo.manifest.themeId,
    coreRuntimeVersion: CORE_VERSION,
    ...extra,
    at: new Date().toISOString(),
  };
}

function assertBoundState(state, packageInfo) {
  if (state.packageDir !== packageInfo.root || state.packageChecksum !== packageInfo.checksumDigest || state.themeId !== packageInfo.manifest.themeId || state.coreRuntimeVersion !== CORE_VERSION) {
    fail('runtime state does not belong to this package');
  }
}

function strictVisualExpression(themeId, contract) {
  const expected = JSON.stringify({ themeId, ...contract });
  return `(() => {
    const expected = ${expected};
    const root = document.documentElement;
    const body = document.querySelector('body[data-application-name="workbuddy"]');
    const rootNode = document.querySelector('#root');
    const rgbFor = (hex) => {
      const value = hex.replace('#', '');
      return 'rgb(' + parseInt(value.slice(0, 2), 16) + ', ' + parseInt(value.slice(2, 4), 16) + ', ' + parseInt(value.slice(4, 6), 16) + ')';
    };
    const resolveColor = (raw) => {
      if (!body || !raw) return '';
      const probe = document.createElement('i');
      probe.style.cssText = 'position:fixed;visibility:hidden;color:' + raw + ';';
      body.appendChild(probe);
      const value = getComputedStyle(probe).color.toLowerCase();
      probe.remove();
      return value;
    };
    const property = (name) => body ? getComputedStyle(body).getPropertyValue(name).trim().toLowerCase() : '';
    const colorMatches = (name, hex) => {
      const raw = property(name);
      return raw.includes(hex) || resolveColor(raw) === rgbFor(hex);
    };
    const style = document.getElementById('codedrobe-theme-style-workbuddy');
    const rootBackground = rootNode ? getComputedStyle(rootNode).backgroundImage : '';
    const art = root?.style.getPropertyValue('--codedrobe-art') ?? '';
    const classNames = [...(root?.classList ?? []), ...(body?.classList ?? [])].join(' ').toLowerCase();
    const themeKind = String(body?.dataset?.vscodeThemeKind ?? root?.dataset?.vscodeThemeKind ?? '').toLowerCase();
    const hasAny = (values) => values.some((value) => classNames.split(/\s+/).includes(value) || themeKind.includes(value));
    const explicitDark = hasAny(['dark', 'cb-dark', 'vscode-dark']);
    const explicitLight = !explicitDark && hasAny(['light', 'cb-light', 'vscode-light']);
    const mode = explicitDark ? 'dark' : (explicitLight || (!explicitDark && window.matchMedia?.('(prefers-color-scheme: light)').matches) ? 'light' : 'dark');
    const palette = expected.modes?.[mode] ?? expected;
    const checks = {
      root: Boolean(root && rootNode),
      workbuddyBody: Boolean(body),
      hostClass: Boolean(root?.classList.contains('codedrobe-host-workbuddy')),
      themeId: root?.dataset.codedrobeTheme === expected.themeId,
      style: Boolean(style?.textContent?.includes('--cb-bg-primary') && style?.textContent?.includes('var(--codedrobe-art)')),
      background: colorMatches('--cb-bg-primary', palette.background),
      editorBackground: colorMatches('--cb-vscode-editor-background', palette.background),
      text: colorMatches('--cb-text-primary', palette.text),
      accent: colorMatches('--cb-button-dark-background', palette.accent),
      artwork: /(?:blob:|data:image)/i.test(art) && /(?:blob:|data:image)/i.test(rootBackground),
    };
    return {
      pass: Object.values(checks).every(Boolean),
      checks,
      mode,
      values: {
        background: property('--cb-bg-primary'),
        editorBackground: property('--cb-vscode-editor-background'),
        text: property('--cb-text-primary'),
        accent: property('--cb-button-dark-background'),
        art: art.slice(0, 96),
      },
    };
  })()`;
}

async function verifyVisualContract(adapter, packageInfo, port) {
  const targets = await findTargets(adapter, port, 8000);
  const expression = strictVisualExpression(packageInfo.manifest.themeId, packageInfo.visualContract);
  const results = [];
  for (const target of targets) {
    const channel = await new CdpSession(target, 10000).open();
    try {
      results.push({ targetId: target.id, result: await channel.evaluate(expression) });
    } finally {
      channel.close();
    }
  }
  const passed = results.find((item) => item.result?.pass);
  if (!passed) {
    const checks = results.map((item) => item.result?.checks ?? {}).slice(0, 3);
    fail(`visual contract verification failed: ${JSON.stringify(checks)}`);
  }
  return { targetId: passed.targetId, mode: passed.result.mode, checks: passed.result.checks, values: passed.result.values };
}

async function verifyAppliedTheme(adapter, packageInfo, port) {
  const coreResults = await verifyTheme({ adapter, targetTheme: packageInfo.targetTheme, port, timeoutMs: 15000 });
  const passingCoreTargets = coreResults.filter((item) => item.result?.pass === true);
  if (!passingCoreTargets.length) fail('Core verification did not find an applied WorkBuddy renderer');
  const visual = await verifyVisualContract(adapter, packageInfo, port);
  await delay(1200);
  const stableVisual = await verifyVisualContract(adapter, packageInfo, port);
  return { coreTargets: passingCoreTargets.length, visual, stableVisual };
}

async function waitForRenderer(adapter, port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await findTargets(adapter, port, Math.min(1500, Math.max(1, deadline - Date.now())));
      if (targets.length) return targets;
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  fail(`WorkBuddy did not expose a matching CDP renderer: ${lastError?.message ?? 'timed out'}`);
}

async function stopWorkBuddyProcesses(adapter, executable) {
  let pids = await findRunningPids(adapter, process.platform, executable);
  for (const pid of pids) {
    // Do not use taskkill /T. A desktop integration can host a launcher below
    // WorkBuddy in the process tree, and killing that tree loses the verified
    // result even though the application restart itself succeeds.
    await execFileAsync('taskkill.exe', ['/F', '/PID', String(pid)]).catch(() => {});
  }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    pids = await findRunningPids(adapter, process.platform, executable);
    if (!pids.length) return;
    await delay(250);
  }
  fail('WorkBuddy did not exit before restart');
}

async function launchWorkBuddy(adapter, port) {
  const discovered = await discoverApp(adapter, process.platform, process.env.WORKBUDDY_EXECUTABLE || null);
  if (!discovered) fail('WorkBuddy is not installed or could not be discovered');
  await stopWorkBuddyProcesses(adapter, discovered.executable);
  const child = spawn(discovered.executable, [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
  ], { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn);
    child.once('error', rejectSpawn);
  });
  child.unref();
  const targets = await waitForRenderer(adapter, port);
  return { port, executable: discovered.executable, pid: child.pid, targets: targets.length };
}

async function startWatcher(packageInfo, stateDir, port) {
  const runner = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [runner, 'watch', '--package-dir', packageInfo.root, '--state-dir', stateDir, '--cdp', `http://127.0.0.1:${port}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, WORKBUDDY_THEME_WATCHER: '1' },
  });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn);
    child.once('error', rejectSpawn);
  });
  child.unref();
  return child.pid;
}

async function stopWatcher(state) {
  const pid = Number(state.watcherPid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  try {
    process.kill(pid);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function normalizedWindowsPath(value) {
  return String(value ?? '').replaceAll('/', '\\').toLowerCase();
}

async function readCompetingWatcherStates(currentPackageRoot) {
  const root = skinStateRoot();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const current = resolve(currentPackageRoot);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const stateDir = join(root, entry.name);
    const statePath = join(stateDir, STATE_FILE);
    let info;
    try {
      info = await lstat(statePath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) continue;
    let state;
    try {
      state = JSON.parse(await readFile(statePath, 'utf8'));
    } catch {
      continue;
    }
    const pid = Number(state?.watcherPid);
    if (state?.status !== 'applied' || state?.coreRuntimeVersion !== CORE_VERSION || !Number.isInteger(pid) || pid <= 0 || pid === process.pid || typeof state.packageDir !== 'string') continue;
    if (resolve(state.packageDir) === current) continue;
    candidates.push({ pid, stateDir, packageDir: resolve(state.packageDir), themeId: typeof state.themeId === 'string' ? state.themeId : null });
  }
  return candidates;
}

async function inspectWindowsProcess(pid) {
  const script = `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue; if ($null -ne $p) { [PSCustomObject]@{ Name = $p.Name; ExecutablePath = $p.ExecutablePath; CommandLine = $p.CommandLine } | ConvertTo-Json -Compress }`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  const source = stdout.trim();
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    fail('unable to inspect an existing WorkBuddy theme watcher');
  }
}

function isVerifiedCoreWatcher(processInfo, candidate) {
  if (String(processInfo?.Name ?? '').toLowerCase() !== 'node.exe') return false;
  const commandLine = normalizedWindowsPath(processInfo?.CommandLine);
  const expectedRunner = normalizedWindowsPath(join(candidate.packageDir, 'runtime', 'core-runner.mjs'));
  const expectedStateDir = normalizedWindowsPath(candidate.stateDir);
  return commandLine.includes(expectedRunner) && commandLine.includes(expectedStateDir) && /(?:^|\s)watch(?:\s|$)/.test(commandLine) && commandLine.includes('--package-dir') && commandLine.includes('--state-dir') && commandLine.includes('--cdp');
}

async function waitForWatcherExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(100);
  }
  fail('a previous WorkBuddy theme watcher did not stop');
}

async function stopCompetingWatchers(currentPackageRoot) {
  const stopped = [];
  for (const candidate of await readCompetingWatcherStates(currentPackageRoot)) {
    const processInfo = await inspectWindowsProcess(candidate.pid);
    if (!processInfo || !isVerifiedCoreWatcher(processInfo, candidate)) continue;
    process.kill(candidate.pid);
    await waitForWatcherExit(candidate.pid);
    stopped.push({ themeId: candidate.themeId, watcherPid: candidate.pid });
  }
  return stopped;
}

async function runDryRun(packageInfo, stateDir) {
  const token = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + 5 * 60_000;
  await saveState(stateDir, packageState(packageInfo, 'prepared', { tokenHash: sha256(token), expiresAt, tokenUsed: false }));
  return { mode: 'dry-run', status: 'prepared', themeId: packageInfo.manifest.themeId, confirmToken: token, expiresAt };
}

async function runApply(packageInfo, stateDir, port, args) {
  if (!args.restart) fail('apply requires the explicit --restart confirmation');
  if (typeof args['confirm-token'] !== 'string') fail('apply requires a confirmation token');
  const state = await readState(stateDir);
  assertBoundState(state, packageInfo);
  if (state.status !== 'prepared' || state.tokenUsed || Date.now() > Number(state.expiresAt) || sha256(args['confirm-token']) !== state.tokenHash) {
    fail('confirmation token is invalid, expired, or already used');
  }
  const confirmed = packageState(packageInfo, 'confirmed', { tokenUsed: true, expiresAt: state.expiresAt });
  await saveState(stateDir, confirmed);
  const adapter = getAdapter('workbuddy');
  try {
    const supersededWatchers = await stopCompetingWatchers(packageInfo.root);
    const launch = await launchWorkBuddy(adapter, port);
    const application = await applySkin({
      adapter,
      targetTheme: packageInfo.targetTheme,
      port: launch.port,
      launch: false,
      timeoutMs: 45000,
    });
    const verification = await verifyAppliedTheme(adapter, packageInfo, application.port);
    const screenshot = join(stateDir, 'verification.png');
    await captureScreenshot({ adapter, port: application.port, output: screenshot, timeoutMs: 15000 });
    const watcherPid = args.watch ? await startWatcher(packageInfo, stateDir, application.port) : null;
    await saveState(stateDir, packageState(packageInfo, 'applied', {
      port: application.port,
      watcherPid,
      screenshot,
      verification,
      supersededWatchers,
    }));
    return { mode: 'apply', status: 'applied', themeId: packageInfo.manifest.themeId, port: application.port, watcherPid, supersededWatchers, verification };
  } catch (error) {
    try {
      await restoreSkin({ adapter, port, timeoutMs: 5000 });
    } catch { /* Keep the primary failure. */ }
    await saveState(stateDir, packageState(packageInfo, 'failed', { error: String(error.message ?? error).slice(0, 800) }));
    throw error;
  }
}

async function runVerify(packageInfo, stateDir, port) {
  const adapter = getAdapter('workbuddy');
  const verification = await verifyAppliedTheme(adapter, packageInfo, port);
  const state = await readState(stateDir);
  if (state.packageChecksum === packageInfo.checksumDigest) {
    await saveState(stateDir, packageState(packageInfo, state.status === 'applied' ? 'applied' : 'verified', {
      port: state.port ?? port,
      watcherPid: state.watcherPid ?? null,
      screenshot: state.screenshot ?? null,
      verification,
    }));
  }
  return { mode: 'verify', status: 'verified', themeId: packageInfo.manifest.themeId, port, verification };
}

async function runRestore(packageInfo, stateDir, port) {
  const state = await readState(stateDir);
  if (state.packageChecksum === packageInfo.checksumDigest) await stopWatcher(state);
  const adapter = getAdapter('workbuddy');
  const restored = await restoreSkin({ adapter, port, timeoutMs: 5000 });
  await saveState(stateDir, packageState(packageInfo, 'restored', { port, watcherPid: null, restoredAt: new Date().toISOString() }));
  return { mode: 'restore', status: 'restored', themeId: packageInfo.manifest.themeId, rendererRestored: restored.renderer?.restored === true };
}

async function runWatch(packageInfo, stateDir, port) {
  const adapter = getAdapter('workbuddy');
  const existing = await readState(stateDir);
  await saveState(stateDir, packageState(packageInfo, 'applied', {
    port,
    watcherPid: process.pid,
    watching: true,
    screenshot: existing.screenshot ?? null,
    verification: existing.verification ?? null,
  }));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await watchTheme({ adapter, targetTheme: packageInfo.targetTheme, port, timeoutMs: 12000, signal: controller.signal });
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    const latest = await readState(stateDir);
    if (latest.watcherPid === process.pid) await saveState(stateDir, { ...latest, watcherPid: null, watching: false, at: new Date().toISOString() });
  }
  return { mode: 'watch', status: 'stopped' };
}

async function main() {
  const mode = process.argv[2];
  if (!MODES.has(mode)) fail('mode must be dry-run, apply, verify, restore, or watch');
  if (process.platform !== 'win32') fail('the Core runner is only for the Windows entry points');
  const args = parseArgs(process.argv.slice(3));
  const packageInfo = await loadPackage(args['package-dir']);
  const stateDir = resolve(args['state-dir'] ?? defaultStateDirectory(packageInfo.root));
  const port = portFromEndpoint(args.cdp);
  if (mode === 'dry-run') return runDryRun(packageInfo, stateDir);
  if (mode === 'apply') return runApply(packageInfo, stateDir, port, args);
  if (mode === 'verify') return runVerify(packageInfo, stateDir, port);
  if (mode === 'restore') return runRestore(packageInfo, stateDir, port);
  return runWatch(packageInfo, stateDir, port);
}

main().then(
  (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
  (error) => {
    process.stderr.write(`${JSON.stringify({ status: 'failed', error: String(error.message ?? error) })}\n`);
    process.exitCode = 1;
  },
);
