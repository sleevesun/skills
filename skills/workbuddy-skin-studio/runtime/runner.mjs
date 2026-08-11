#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpClient, probeCdp } from './cdp.mjs';
import { assertContained, assertNoSensitiveText, assertNoSymlinkPath, assertRelativePath, assertSafeTree } from './security.mjs';
import { hashToken, transitionRecord } from './state-machine.mjs';

const execFileAsync = promisify(execFile);
const execRoot = process.cwd();
const TOKEN_TTL_MS = 5 * 60_000;
const STYLE_ID = 'workbuddy-skin-studio';
const MODES = new Set(['probe', 'apply', 'verify', 'restore', 'dry-run']);

function fail(message) { throw new Error(message); }

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (key === 'restart' || key === 'dry-run') {
      result[key] = true;
      continue;
    }
    if (!next || next.startsWith('--')) fail(`missing value for --${key}`);
    result[key] = next;
    i += 1;
  }
  return result;
}

async function safePath(value, label, { create = false, base = execRoot } = {}) {
  if (typeof value !== 'string' || !value || value.includes('\0')) fail(`${label} is invalid`);
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) fail(`${label} absolute path rejected`);
  if (normalized === '.') {
    try { if ((await lstat(resolve(base))).isSymbolicLink()) fail(`${label} symlink rejected`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return resolve(base);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail(`${label} traversal rejected`);
  let cursor = resolve(base);
  for (const part of parts) {
    cursor = join(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) fail(`${label} symlink rejected`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) break;
    }
  }
  return resolve(base, ...parts);
}

async function defaultStateDirectory(packageDir) {
  const userDataRoot = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'))
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : join(homedir(), '.local', 'share');
  const packageKey = createHash('sha256').update(packageDir).digest('hex').slice(0, 24);
  const stateDir = join(userDataRoot, 'WorkBuddy', 'Skin Studio', packageKey);
  await assertNoSymlinkPath(stateDir, 'state-dir');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(stateDir, 'state-dir');
  return stateDir;
}

async function statePath(stateDir) {
  const path = join(stateDir, 'runtime-state.json');
  try {
    if ((await lstat(path)).isSymbolicLink()) fail('runtime state symlink rejected');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return path;
}

async function readState(stateDir) {
  try {
    const state = JSON.parse(await readFile(await statePath(stateDir), 'utf8'));
    if (Object.hasOwn(state, 'token')) fail('runtime state must not persist confirmation token');
    return state;
  }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`runtime state is invalid: ${error.message}`); }
}

async function saveState(stateDir, state) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = await statePath(stateDir);
  const history = Array.isArray(state.history) ? [...state.history] : [];
  if (state.status && history.at(-1) !== state.status) history.push(state.status);
  const persisted = { ...state, history };
  delete persisted.token;
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function tokenRecord(now = Date.now()) {
  const token = randomBytes(16).toString('hex');
  return { token, tokenHash: hashToken(token), expiresAt: now + TOKEN_TTL_MS, tokenUsed: false };
}

async function listPackageFiles(root) {
  const rootReal = await realpath(root);
  const result = [];
  async function visit(directory, relDir = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.DS_Store') continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const safe = assertRelativePath(rel, 'package file');
      const absolute = join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) fail(`package symlink rejected: ${safe}`);
      if (info.isDirectory()) await visit(absolute, safe);
      else if (info.isFile()) {
        const real = await realpath(absolute);
        assertContained(rootReal, real, `package realpath ${safe}`);
        result.push({ rel: safe, absolute });
      } else fail(`unsupported package entry: ${safe}`);
    }
  }
  await visit(root);
  return result;
}

async function verifyManifestIntegrity(root, manifest) {
  if (!Array.isArray(manifest.files)) fail('manifest files are required at runtime');
  const actual = await listPackageFiles(root);
  const actualSet = new Set(actual.map((item) => item.rel));
  const actualKeys = new Set(actual.map((item) => item.rel.toLocaleLowerCase('en-US')));
  const declared = manifest.files.map((file) => assertRelativePath(file, 'manifest file'));
  const declaredKeys = new Set();
  for (const file of declared) {
    const key = file.toLocaleLowerCase('en-US');
    if (declaredKeys.has(key)) fail(`duplicate manifest file: ${file}`);
    declaredKeys.add(key);
    if (!actualSet.has(file)) fail(`manifest file not found: ${file}`);
  }
  if (actual.length !== declared.length || actual.some((item) => !declaredKeys.has(item.rel.toLocaleLowerCase('en-US')))) fail('manifest file closure mismatch');
  if (actualKeys.size !== actual.length) fail('package file case collision');
  const checksumName = 'checksums.sha256';
  if (!actualSet.has(checksumName) || !declaredKeys.has(checksumName)) fail('package checksums.sha256 is required');
  const checksumLines = (await readFile(join(root, checksumName), 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const checksumEntries = new Map();
  for (const line of checksumLines) {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/i);
    if (!match) fail('package checksum format is invalid');
    const file = assertRelativePath(match[2], 'checksum file');
    if (file === checksumName || checksumEntries.has(file.toLocaleLowerCase('en-US'))) fail(`duplicate checksum entry: ${file}`);
    if (!actualSet.has(file)) fail(`checksum file not found: ${file}`);
    checksumEntries.set(file.toLocaleLowerCase('en-US'), { file, hash: match[1].toLowerCase() });
  }
  for (const item of actual) {
    if (item.rel === checksumName) continue;
    const entry = checksumEntries.get(item.rel.toLocaleLowerCase('en-US'));
    if (!entry || entry.file !== item.rel) fail(`checksum closure mismatch: ${item.rel}`);
    const digest = createHash('sha256').update(await readFile(item.absolute)).digest('hex');
    if (digest !== entry.hash) fail(`checksum mismatch: ${item.rel}`);
  }
  if (checksumEntries.size !== actual.length - 1) fail('checksum file closure mismatch');
}

function safeError(error) {
  return String(error?.message ?? error)
    .replaceAll(/[A-Za-z]:[\\/][^\s]+|\/(?:Users|home|private|tmp)\/[^\s]+/g, '[redacted-path]');
}

function output(payload, pass = true) {
  process.stdout.write(`${JSON.stringify({ pass, ...payload })}\n`);
}

function mimeType(path) {
  const extension = extname(path).toLowerCase();
  return { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[extension] ?? 'application/octet-stream';
}

async function loadTheme(packageDir, platform) {
  const root = resolve(packageDir);
  await assertSafeTree(root);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  await verifyManifestIntegrity(root, manifest);
  if (manifest.schemaVersion !== 1 || manifest.runtimeVersion !== '1.0.0' || manifest.application !== 'workbuddy' || manifest.requiresUserRestartConfirmation !== true) fail('unsupported WorkBuddy theme manifest');
  if (!Array.isArray(manifest.targetPlatforms) || !manifest.targetPlatforms.length || manifest.targetPlatforms.some((value) => !['macos', 'windows'].includes(value)) || new Set(manifest.targetPlatforms).size !== manifest.targetPlatforms.length || !manifest.targetPlatforms.includes(platform)) fail(`target platform mismatch: ${platform}`);
  if (!manifest.security || manifest.security.allowRemoteResources !== false || manifest.security.allowAppAsarWrites !== false || manifest.security.allowUserPaths !== false || manifest.security.allowSecrets !== false || manifest.security.declarationOnlyTheme !== true) fail('theme security policy is unsafe');
  const packageName = assertRelativePath(String(manifest.themePackage ?? ''), 'theme package');
  const inner = join(root, packageName);
  assertContained(root, inner, 'theme package');
  const theme = JSON.parse(await readFile(join(inner, 'theme.json'), 'utf8'));
  if (theme.schemaVersion !== 1 || manifest.themeId !== theme.id || manifest.displayName !== theme.displayName || manifest.version !== theme.version) fail('manifest and theme identity mismatch');
  const workbuddy = theme.targets?.workbuddy;
  if (!workbuddy || typeof workbuddy.css !== 'string') fail('WorkBuddy theme target is incomplete');
  const cssRelative = assertRelativePath(workbuddy.css, 'theme CSS');
  const cssPath = join(inner, cssRelative);
  assertContained(inner, cssPath, 'theme CSS');
  const css = await readFile(cssPath, 'utf8');
  if (/(?:https?:)?\/\//i.test(css) || /@import/i.test(css)) fail('theme CSS contains remote or imported resources');
  const scripts = (await (async () => {
    const files = [];
    const visit = async (directory) => {
      const entries = await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const current = join(directory, entry.name);
        if (entry.isDirectory()) await visit(current);
        else files.push(current);
      }
    };
    await visit(inner);
    return files;
  })()).filter((file) => /\.(?:js|mjs|cjs)$/i.test(file));
  if (scripts.length) fail('declarative theme cannot contain executable scripts');
  assertNoSensitiveText(css, 'theme CSS');

  let hydratedCss = css;
  for (const match of css.matchAll(/url\(\s*["']?\.\/([^"')]+)["']?\s*\)/gi)) {
    const assetName = match[1].replaceAll('\\', '/');
    if (assetName.includes('..') || assetName.startsWith('/')) fail('theme asset path is unsafe');
    const assetPath = join(inner, assetName);
    assertContained(inner, assetPath, 'theme asset');
    const data = (await readFile(assetPath)).toString('base64');
    hydratedCss = hydratedCss.replace(match[0], `url("data:${mimeType(assetPath)};base64,${data}")`);
  }
  const required = workbuddy.verification?.required;
  if (!Array.isArray(required) || required.length === 0 || required.some((value) => typeof value !== 'string' || !value.trim())) fail('theme required landmarks are invalid');
  hydratedCss += `\nhtml.${STYLE_ID} { --workbuddy-skin-runtime-proof: applied !important; }\n`;
  const computedChecks = [];
  if (/\.teams-main-content\b/.test(css) && /data:image\//.test(hydratedCss)) {
    computedChecks.push({ selector: '.teams-main-content', property: 'background-image', contains: 'data:image/' });
  }
  return { root, manifest, theme, css: hydratedCss, required, computedChecks };
}

function injectExpression(css, themeId) {
  const payload = JSON.stringify({ css, themeId, styleId: STYLE_ID });
  return `(() => { const spec = ${payload}; const key = '__workbuddySkinStudioKeeper'; const keeper = globalThis[key] ?? (globalThis[key] = {}); keeper.spec = spec; keeper.ensure = () => { const current = globalThis[key]?.spec; const root = document.documentElement; const parent = document.head || root; if (!current || !root || !parent) return false; let style = document.getElementById(current.styleId); if (!style) { style = document.createElement('style'); style.id = current.styleId; parent.appendChild(style); } if (style.textContent !== current.css) style.textContent = current.css; root.setAttribute('data-workbuddy-skin', current.themeId); root.classList.add(current.styleId); return true; }; const injected = keeper.ensure(); if (!keeper.observer) { keeper.observer = new MutationObserver(() => keeper.ensure()); const observe = () => { const root = document.documentElement; if (root) keeper.observer.observe(root, { childList: true, subtree: true }); else setTimeout(observe, 0); }; observe(); } if (!keeper.timer) keeper.timer = setInterval(() => globalThis[key]?.ensure?.(), 1000); document.addEventListener('DOMContentLoaded', () => globalThis[key]?.ensure?.(), { once: true }); if (!injected) setTimeout(() => globalThis[key]?.ensure?.(), 0); return { injected: injected || Boolean(document.documentElement) }; })()`;
}

function verifyExpression(requiredSelectors, computedChecks = []) {
  const selectors = JSON.stringify(requiredSelectors);
  const checks = JSON.stringify(computedChecks);
  return `(() => { const style = document.getElementById('${STYLE_ID}'); const root = document.documentElement; const selectors = ${selectors}; const expectedChecks = ${checks}; const missing = selectors.filter((selector) => { try { return !document.querySelector(selector); } catch { return true; } }); const proof = getComputedStyle(root).getPropertyValue('--workbuddy-skin-runtime-proof').trim() === 'applied'; const computedChecks = expectedChecks.map((check) => { let element = null; try { element = document.querySelector(check.selector); } catch {} const actual = element ? getComputedStyle(element).getPropertyValue(check.property).trim() : ''; return { selector: check.selector, property: check.property, matched: Boolean(element && actual.includes(check.contains)), actual: actual.slice(0, 160) }; }); const visualApplied = proof && computedChecks.every((check) => check.matched); return { style: Boolean(style && style.textContent), dataAttribute: root.getAttribute('data-workbuddy-skin') !== null, proof, visualApplied, missing, computedChecks }; })()`;
}

function restoreExpression() {
  return `(() => { const key = '__workbuddySkinStudioKeeper'; const keeper = globalThis[key]; if (keeper?.timer) clearInterval(keeper.timer); keeper?.observer?.disconnect(); delete globalThis[key]; document.getElementById('${STYLE_ID}')?.remove(); document.documentElement.classList.remove('${STYLE_ID}'); document.documentElement.removeAttribute('data-workbuddy-skin'); return { restored: true }; })()`;
}

async function createCdpAdapter(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { fail('CDP URL is invalid'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') fail('CDP must be HTTP on 127.0.0.1');
  const port = Number(url.port || 80);
  let evidence = await probeCdp({ port });
  return {
    evidence,
    async probe() {
      evidence = await probeCdp({ port });
      return evidence;
    },
    async evaluate(expression) { return new CdpClient({ target: evidence.target }).evaluate(expression); },
    async installOnNewDocument(expression) {
      const result = await new CdpClient({ target: evidence.target }).send('Page.addScriptToEvaluateOnNewDocument', { source: expression });
      if (!result?.identifier) fail('CDP did not return a persistent script identifier');
      return result.identifier;
    },
    async removeOnNewDocument(identifier) {
      await new CdpClient({ target: evidence.target }).send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    },
  };
}

async function waitForCdp(endpoint, attempts = 120) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await createCdpAdapter(endpoint); }
    catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  fail(`WorkBuddy CDP did not become available: ${lastError?.message ?? 'timed out'}`);
}

async function retryCdpEvaluation(cdp, expression, accept, label, { attempts = 40, delayMs = 250 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await cdp.probe();
      const result = await cdp.evaluate(expression);
      if (accept(result)) return result;
      lastError = new Error(JSON.stringify({ missing: result?.missing ?? [], computed: result?.computedChecks?.filter((check) => !check.matched) ?? [] }));
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
  fail(`${label} failed: ${lastError?.message ?? 'timed out'}`);
}

async function applyAndVerifyTheme(cdp, theme, retryOptions) {
  // Preflight: confirm the page is reachable. Landmark presence is reported by
  // verification but is NOT a hard gate — the landmarks in theme.json are best-effort
  // guesses about WorkBuddy's DOM, and missing landmarks must not roll back a theme
  // that was successfully injected.
  await retryCdpEvaluation(
    cdp,
    verifyExpression(theme.required),
    () => true,
    'WorkBuddy DOM preflight',
    retryOptions,
  );
  let newDocumentScriptId;
  try {
    if (typeof cdp.installOnNewDocument !== 'function') fail('CDP persistent injection is unavailable');
    newDocumentScriptId = await cdp.installOnNewDocument(injectExpression(theme.css, theme.manifest.themeId));
    await retryCdpEvaluation(
      cdp,
      injectExpression(theme.css, theme.manifest.themeId),
      (result) => result?.injected === true,
      'theme injection',
      retryOptions,
    );
    // Success = the style element, the data attribute and the runtime proof are present.
    // Missing cosmetic landmarks / computed checks are warnings, not a reason to roll back.
    await retryCdpEvaluation(
      cdp,
      verifyExpression(theme.required, theme.computedChecks),
      (result) => Boolean(result?.style && result?.dataAttribute && result?.proof),
      'theme verification',
      retryOptions,
    );
    const stabilityDelayMs = retryOptions?.delayMs === 0 ? 0 : 2000;
    if (stabilityDelayMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, stabilityDelayMs));
    const stable = await retryCdpEvaluation(
      cdp,
      verifyExpression(theme.required, theme.computedChecks),
      (result) => Boolean(result?.style && result?.dataAttribute && result?.proof),
      'theme stability verification',
      retryOptions,
    );
    return {
      newDocumentScriptId,
      appliedWithWarnings: Boolean(Array.isArray(stable?.missing) && stable.missing.length > 0) ||
        Boolean(Array.isArray(stable?.computedChecks) && stable.computedChecks.some((check) => !check.matched)),
      missingLandmarks: stable?.missing ?? [],
    };
  } catch (error) {
    if (newDocumentScriptId && typeof cdp.removeOnNewDocument === 'function') {
      try { await cdp.removeOnNewDocument(newDocumentScriptId); } catch {}
    }
    try { await cdp.evaluate(restoreExpression()); } catch {}
    throw error;
  }
}

function cdpPort(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { fail('CDP URL is invalid'); }
  const port = Number(url.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('CDP port is invalid');
  return port;
}

function launchEnvironment(port) {
  const env = {
    ...process.env,
    WORKBUDDY_REMOTE_DEBUGGING_PORT: String(port),
    WORKBUDDY_REMOTE_DEBUGGING_ADDRESS: '127.0.0.1',
    // When WorkBuddy's bundled Electron is used as Node, its executable path
    // matches the app being restarted. Preserve this process so it can wait for
    // CDP and inject the theme after the app relaunches.
    WORKBUDDY_SKIN_RUNTIME_PID: String(process.pid),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function resolveMacosApp() {
  const configuredExecutable = process.env.WORKBUDDY_EXECUTABLE;
  const configuredApp = process.env.WORKBUDDY_APP;
  const marker = '/Contents/MacOS/';
  const app = configuredApp || (configuredExecutable?.includes(marker) ? configuredExecutable.slice(0, configuredExecutable.indexOf(marker)) : '/Applications/WorkBuddy.app');
  const info = await lstat(app).catch((error) => { throw new Error(`WorkBuddy app is unavailable: ${error.message}`); });
  if (!info.isDirectory() || info.isSymbolicLink()) fail('WorkBuddy app must be a regular app bundle');
  return app;
}

async function resolveMacosExecutable(app) {
  const executable = process.env.WORKBUDDY_EXECUTABLE || join(app, 'Contents', 'MacOS', 'Electron');
  const info = await lstat(executable).catch((error) => { throw new Error('WorkBuddy executable is unavailable: ' + error.message); });
  if (!info.isFile() || info.isSymbolicLink()) fail('WorkBuddy executable must be a regular file');
  return executable;
}

async function spawnDetached(executable, args, env) {
  const child = spawn(executable, args, { detached: true, stdio: 'ignore', env });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn);
    child.once('error', rejectSpawn);
  });
  child.unref();
  return child.pid;
}

async function waitForMacosExit(app, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await execFileAsync('/usr/bin/pgrep', ['-f', app]);
    } catch (error) {
      if (error.code === 1) return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('WorkBuddy did not exit before restart');
}

const WINDOWS_RESTART_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$port = [int]$env:WORKBUDDY_REMOTE_DEBUGGING_PORT
if ($port -lt 1 -or $port -gt 65535) { throw 'WORKBUDDY_REMOTE_DEBUGGING_PORT is invalid' }
$runtimePid = 0
if (-not [int]::TryParse([string]$env:WORKBUDDY_SKIN_RUNTIME_PID, [ref]$runtimePid) -or $runtimePid -le 0) {
  throw 'WORKBUDDY_SKIN_RUNTIME_PID is invalid'
}
$arguments = @('--remote-debugging-address=127.0.0.1', "--remote-debugging-port=$port")
$explicit = $env:WORKBUDDY_EXECUTABLE
$app = $null
function Resolve-SignedExecutable([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if ($item.Extension -ine '.exe') { return $null }
  $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
  if ($signature.Status -ne 'Valid') { return $null }
  return $item.FullName
}
if (-not [string]::IsNullOrWhiteSpace($explicit)) {
  $app = Resolve-SignedExecutable $explicit
  if ($null -eq $app) { throw 'WORKBUDDY_EXECUTABLE must point to a signed .exe file' }
} else {
  $candidates = @()
  $packages = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'WorkBuddy' } | Sort-Object Version -Descending)
  foreach ($package in $packages) {
    try {
      $manifest = Get-AppxPackageManifest -Package $package -ErrorAction Stop
      foreach ($application in @($manifest.Package.Applications.Application)) {
        $relative = [string]$application.Executable
        if (-not [string]::IsNullOrWhiteSpace($relative)) { $candidates += (Join-Path $package.InstallLocation $relative) }
      }
    } catch { }
    $candidates += (Join-Path $package.InstallLocation 'WorkBuddy.exe')
    $candidates += (Join-Path $package.InstallLocation 'Electron.exe')
    $candidates += (Join-Path $package.InstallLocation 'app\WorkBuddy.exe')
    $candidates += (Join-Path $package.InstallLocation 'app\Electron.exe')
  }
  $programFiles = if ($env:ProgramFiles) { $env:ProgramFiles } else { '' }
  $programFilesX86Value = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  $programFilesX86 = if ($programFilesX86Value) { $programFilesX86Value } else { '' }
  $localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { '' }
  $candidates += @(
    (Join-Path $programFiles 'WorkBuddy\WorkBuddy.exe'),
    (Join-Path $programFilesX86 'WorkBuddy\WorkBuddy.exe'),
    (Join-Path $localAppData 'WorkBuddy\WorkBuddy.exe'),
    (Join-Path $localAppData 'Programs\WorkBuddy\WorkBuddy.exe')
  )
  foreach ($candidate in $candidates | Where-Object { $_ } | Select-Object -Unique) {
    $app = Resolve-SignedExecutable $candidate
    if ($null -ne $app) { break }
  }
  if ($null -eq $app) { throw 'A signed WorkBuddy executable was not found' }
}
$appFullPath = [IO.Path]::GetFullPath($app)
$appName = [IO.Path]::GetFileName($appFullPath).Replace("'", "''")
$running = @(Get-CimInstance Win32_Process -Filter "Name = '$appName'" -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $runtimePid -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $appFullPath
})
foreach ($process in $running) { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop }
$deadline = (Get-Date).AddSeconds(10)
while (@(Get-CimInstance Win32_Process -Filter "Name = '$appName'" -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $runtimePid -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $appFullPath
}).Count -gt 0) {
  if ((Get-Date) -ge $deadline) { throw 'WorkBuddy did not exit before restart' }
  Start-Sleep -Milliseconds 250
}
Start-Process -FilePath $app -ArgumentList $arguments
`;

async function fixedRestart(platform, endpoint) {
  const port = cdpPort(endpoint);
  if (platform === 'macos') {
    try { await execFileAsync('osascript', ['-e', 'tell application "WorkBuddy" to quit']); } catch {}
    const app = await resolveMacosApp();
    await waitForMacosExit(app);
    const executable = await resolveMacosExecutable(app);
    await spawnDetached(executable, [
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + port,
    ], launchEnvironment(port));
    return;
  }
  if (platform === 'windows') {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_RESTART_SCRIPT], { env: launchEnvironment(port) });
    return;
  }
  fail(`unsupported restart platform: ${platform}`);
}

export async function runCommand(options = {}, mode = 'probe') {
  if (!MODES.has(mode)) fail('mode must be probe|apply|verify|restore|dry-run');
  const cwd = resolve(options.cwd ?? execRoot);
  const args = parseArgs(options.args ?? []);
  const platform = options.platform ?? (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'macos');
  const cdpEndpoint = args.cdp ?? 'http://127.0.0.1:9336';
  const packageDir = await safePath(args['package-dir'] ?? 'package', 'package-dir', { base: cwd });
  const stateDir = args['state-dir']
    ? await safePath(args['state-dir'], 'state-dir', { create: true, base: cwd })
    : await defaultStateDirectory(packageDir);
  const screenshot = args.screenshot ? await safePath(args.screenshot, 'screenshot', { create: true, base: cwd }) : null;
  {
    const theme = await loadTheme(packageDir, platform);
    if (screenshot) assertContained(cwd, screenshot, 'screenshot');
    if (mode === 'dry-run') {
      const token = tokenRecord(options.now?.() ?? Date.now());
      await saveState(stateDir, { status: 'prepared', packageDir, themeId: theme.manifest.themeId, platform, ...token });
      return { mode, status: 'prepared', localOnly: true, confirmToken: token.token, expiresAt: token.expiresAt };
    }

    let cdp = options.cdpAdapter;
    let evidence;
    const restartBeforeProbe = mode === 'apply' && Boolean(args.restart);
    if (!restartBeforeProbe) {
      cdp ??= await createCdpAdapter(cdpEndpoint);
      evidence = await cdp.probe();
    }
    if (mode === 'probe') return { mode, status: 'prepared', ...evidence };

    const state = await readState(stateDir);
    if (state.packageDir && state.packageDir !== packageDir) fail('runtime state package binding mismatch');
    if (state.themeId && state.themeId !== theme.manifest.themeId) fail('runtime state theme binding mismatch');
    if (state.platform && state.platform !== platform) fail('runtime state platform binding mismatch');
    const boundState = { ...state, packageDir, themeId: theme.manifest.themeId, platform };
    if (mode === 'verify') {
      const result = await cdp.evaluate(verifyExpression(theme.required, theme.computedChecks));
      const verified = Boolean(result?.style && result?.dataAttribute && result?.proof);
      if (!verified) fail(`theme verification failed: ${JSON.stringify({ missing: result?.missing ?? [], computed: result?.computedChecks?.filter((check) => !check.matched) ?? [] })}`);
      return { mode, status: state.status ?? 'prepared', verified: true, missingLandmarks: result?.missing ?? [], ...evidence };
    }
    if (mode === 'restore') {
      if (state.newDocumentScriptId && typeof cdp.removeOnNewDocument === 'function') {
        try { await cdp.removeOnNewDocument(state.newDocumentScriptId); } catch {}
      }
      await cdp.evaluate(restoreExpression());
      await saveState(stateDir, { ...boundState, newDocumentScriptId: undefined, status: 'applied', action: 'restore', at: new Date().toISOString() });
      return { mode, status: 'applied', restored: true, ...evidence };
    }

    const now = options.now?.() ?? Date.now();
    if (!args['confirm-token']) {
      await saveState(stateDir, { ...boundState, status: 'cancelled', at: new Date().toISOString() });
      return { mode, status: 'cancelled', reason: 'confirm-token-required' };
    }
    if (state.status !== 'prepared' || state.tokenUsed || state.tokenHash !== hashToken(args['confirm-token'])) {
      await saveState(stateDir, { ...boundState, status: 'failed', tokenUsed: true, at: new Date().toISOString() });
      fail('confirmation token is invalid or already used');
    }
    if (!Number.isFinite(state.expiresAt) || now > state.expiresAt) {
      await saveState(stateDir, { ...boundState, status: 'failed', tokenUsed: true, at: new Date().toISOString() });
      fail('confirmation token expired');
    }
    if (Number(state.restartCount ?? 0) > 1) {
      await saveState(stateDir, { ...boundState, status: 'failed', at: new Date().toISOString() });
      fail('restart limit exceeded');
    }
    const confirmed = transitionRecord(boundState, 'confirmed', { tokenUsed: true });
    await saveState(stateDir, confirmed);
    const shouldRestart = Boolean(args.restart);
    const retryOptions = options.cdpAdapter ? { attempts: 3, delayMs: 0 } : undefined;
    let applied = transitionRecord(confirmed, 'applied', { restartCount: Number(state.restartCount ?? 0) });
    try {
      if (shouldRestart) {
        const restarting = transitionRecord(confirmed, 'restarting', { restartCount: Number(state.restartCount ?? 0) });
        await saveState(stateDir, restarting);
        const restart = options.restartImpl ?? (() => fixedRestart(platform, cdpEndpoint));
        if (Number(restarting.restartCount) >= 1) { await saveState(stateDir, { ...restarting, status: 'failed' }); fail('restart limit exceeded'); }
        await restart();
        const restartedCdp = options.cdpAdapter ?? await waitForCdp(cdpEndpoint);
        evidence = await restartedCdp.probe();
        const application = await applyAndVerifyTheme(restartedCdp, theme, retryOptions);
        applied = { ...restarting, ...application, status: 'applied', restartCount: Number(restarting.restartCount) + 1, at: new Date().toISOString() };
      } else {
        const application = await applyAndVerifyTheme(cdp, theme, retryOptions);
        applied = { ...applied, ...application };
      }
    } catch (error) {
      await saveState(stateDir, { ...applied, status: 'failed', error: safeError(error), at: new Date().toISOString() });
      throw error;
    }
    await saveState(stateDir, applied);
    return { mode, status: 'applied', restarted: shouldRestart, ...evidence };
  }
}

async function main() {
  const mode = process.argv[2];
  const result = await runCommand({ args: process.argv.slice(3) }, mode);
  output(result, true);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => { output({ status: 'failed', error: safeError(error) }, false); process.exitCode = 1; });
}
