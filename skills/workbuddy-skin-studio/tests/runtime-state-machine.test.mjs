import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CdpClient, probeCdp } from '../runtime/cdp.mjs';
import { runCommand } from '../runtime/runner.mjs';

const studio = fileURLToPath(new URL('..', import.meta.url));
const fixture = join(studio, 'tests/fixtures/valid-both');

function fakeCdp() {
  const calls = [];
  const dom = { injected: false, installedScripts: [], removedScripts: [] };
  return {
    calls,
    dom,
    async probe() {
      return {
        browser: 'WorkBuddy/5.2.6',
        target: { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/1' },
        version: 'WorkBuddy/5.2.6',
      };
    },
    async evaluate(expression) {
      calls.push(expression);
      if (expression.includes('keeper.spec = spec') && expression.includes('workbuddy-skin-studio')) {
        dom.injected = true;
        return { injected: true };
      }
      if (expression.includes('removeAttribute')) {
        dom.injected = false;
        return { restored: true };
      }
      return { style: dom.injected, dataAttribute: dom.injected, proof: dom.injected, visualApplied: dom.injected, missing: [], computedChecks: [] };
    },
    async installOnNewDocument(expression) {
      calls.push(`Page.addScriptToEvaluateOnNewDocument:${expression}`);
      dom.installedScripts.push(expression);
      return 'persistent-script-1';
    },
    async removeOnNewDocument(identifier) {
      calls.push(`Page.removeScriptToEvaluateOnNewDocument:${identifier}`);
      dom.removedScripts.push(identifier);
    },
  };
}

async function setup() {
  const root = await mkdtemp('/tmp/wb-runtime-p2-');
  await cp(fixture, join(root, 'package'), { recursive: true });
  return root;
}

async function refreshChecksum(root, rel) {
  const content = await readFile(join(root, 'package', rel));
  const digest = createHash('sha256').update(content).digest('hex');
  const checksumPath = join(root, 'package/checksums.sha256');
  const lines = (await readFile(checksumPath, 'utf8')).split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim().endsWith(`  ${rel}`));
  assert.notEqual(index, -1, `checksum entry missing for ${rel}`);
  lines[index] = `${digest}  ${rel}`;
  await writeFile(checksumPath, lines.join('\n'), 'utf8');
}

const options = (root, cdp, extra = {}) => ({
  cwd: root,
  cdpAdapter: cdp,
  platform: 'macos',
  args: ['--package-dir', 'package', '--state-dir', 'state', ...(extra.args ?? [])],
  ...extra,
});

test('dry-run is local state-only and apply injects, verifies, and restores through CDP', async () => {
  const root = await setup();
  try {
    await writeFile(join(root, 'package/.DS_Store'), 'Finder metadata\n', 'utf8');
    const cdp = fakeCdp();
    const prepared = await runCommand(options(root, cdp, { args: ['--package-dir', 'package', '--state-dir', 'state'] }), 'dry-run');
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.localOnly, true);
    assert.equal(cdp.calls.length, 0);
    const state = JSON.parse(await readFile(join(root, 'state/runtime-state.json'), 'utf8'));
    assert.match(state.tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(state, 'token'), false);
    assert.ok(state.expiresAt > 0);
    assert.equal(state.tokenUsed, false);

    const applied = await runCommand(options(root, cdp, { args: ['--package-dir', 'package', '--state-dir', 'state', '--confirm-token', prepared.confirmToken] }), 'apply');
    assert.equal(applied.status, 'applied');
    assert.equal(applied.restarted, false);
    assert.equal(cdp.dom.injected, true);
    const injection = cdp.calls.find((expression) => expression.includes('keeper.spec = spec'));
    assert.match(injection, /data:image\/svg\+xml;base64/);
    assert.match(injection, /workbuddy-skin-studio/);

    const verified = await runCommand(options(root, cdp), 'verify');
    assert.equal(verified.verified, true);
    await runCommand(options(root, cdp), 'restore');
    assert.equal(cdp.dom.injected, false);
    assert.match(cdp.calls.at(-1), /removeAttribute/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime rejects modified package checksums and state-file symlinks before side effects', async (t) => {
  const root = await setup();
  try {
    const cdp = fakeCdp();
    await writeFile(join(root, 'package/theme.codedrobe-theme/workbuddy.css'), 'tampered', 'utf8');
    await assert.rejects(() => runCommand(options(root, cdp), 'dry-run'), /checksum mismatch|closure/i);

    const cleanRoot = await setup();
    try {
      await mkdir(join(cleanRoot, 'state'), { recursive: true });
      try { await symlink('/tmp/should-not-be-written', join(cleanRoot, 'state/runtime-state.json')); }
      catch (error) {
        if (error?.code === 'EPERM') { t.skip('当前 Windows 账户不允许创建符号链接'); return; }
        throw error;
      }
      await assert.rejects(() => runCommand(options(cleanRoot, fakeCdp()), 'dry-run'), /state symlink|symbolic/i);
    } finally {
      await rm(cleanRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime enforces manifest security, platform, and theme identity contracts', async () => {
  for (const mutate of [
    async (root) => { const manifest = JSON.parse(await readFile(join(root, 'package/manifest.json'), 'utf8')); manifest.security.allowUserPaths = true; await writeFile(join(root, 'package/manifest.json'), `${JSON.stringify(manifest)}\n`); await refreshChecksum(root, 'manifest.json'); },
    async (root) => { const manifest = JSON.parse(await readFile(join(root, 'package/manifest.json'), 'utf8')); manifest.targetPlatforms = ['linux']; await writeFile(join(root, 'package/manifest.json'), `${JSON.stringify(manifest)}\n`); await refreshChecksum(root, 'manifest.json'); },
    async (root) => { const manifest = JSON.parse(await readFile(join(root, 'package/manifest.json'), 'utf8')); manifest.themeId = 'other-theme'; await writeFile(join(root, 'package/manifest.json'), `${JSON.stringify(manifest)}\n`); await refreshChecksum(root, 'manifest.json'); },
    async (root) => { const theme = JSON.parse(await readFile(join(root, 'package/theme.codedrobe-theme/theme.json'), 'utf8')); theme.displayName = 'Other Theme'; await writeFile(join(root, 'package/theme.codedrobe-theme/theme.json'), `${JSON.stringify(theme)}\n`); await refreshChecksum(root, 'theme.codedrobe-theme/theme.json'); },
  ]) {
    const root = await setup();
    try {
      await mutate(root);
      await assert.rejects(() => runCommand(options(root, fakeCdp()), 'dry-run'), /security|platform|identity|manifest|theme/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('expired and reused tokens fail closed, and restart is limited to one fixed call', async () => {
  const root = await setup();
  try {
    let now = 1000;
    const cdp = fakeCdp();
    const prepared = await runCommand(options(root, cdp, { now: () => now }), 'dry-run');
    now += 5 * 60_000 + 1;
    await assert.rejects(() => runCommand(options(root, cdp, { now: () => now, args: ['--package-dir', 'package', '--state-dir', 'state', '--confirm-token', prepared.confirmToken] }), 'apply'), /expired/i);
    let state = JSON.parse(await readFile(join(root, 'state/runtime-state.json'), 'utf8'));
    assert.equal(state.status, 'failed');

    now = 1000;
    const preparedAgain = await runCommand(options(root, cdp, { now: () => now, args: ['--package-dir', 'package', '--state-dir', 'state'] }), 'dry-run');
    let restarts = 0;
    const applyOptions = options(root, cdp, {
      now: () => now,
      restartImpl: async () => { restarts += 1; },
      args: ['--package-dir', 'package', '--state-dir', 'state', '--confirm-token', preparedAgain.confirmToken, '--restart'],
    });
    const applied = await runCommand(applyOptions, 'apply');
    assert.equal(applied.restarted, true);
    assert.equal(restarts, 1);
    state = JSON.parse(await readFile(join(root, 'state/runtime-state.json'), 'utf8'));
    assert.deepEqual(state.history, ['prepared', 'confirmed', 'restarting', 'applied']);
    await assert.rejects(() => runCommand(options(root, cdp, { args: ['--package-dir', 'package', '--state-dir', 'state', '--confirm-token', preparedAgain.confirmToken] }), 'apply'), /used|confirm|operation/i);
    state = JSON.parse(await readFile(join(root, 'state/runtime-state.json'), 'utf8'));
    assert.equal(state.status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restart apply can bring up WorkBuddy CDP before the first probe', async () => {
  const root = await setup();
  try {
    let ready = false;
    let probes = 0;
    const base = fakeCdp();
    const cdp = {
      ...base,
      async probe() {
        probes += 1;
        if (!ready) throw new Error('CDP is not ready yet');
        return { browser: 'WorkBuddy/5.2.6', target: { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/1' }, version: 'WorkBuddy/5.2.6' };
      },
    };
    const prepared = await runCommand(options(root, cdp), 'dry-run');
    const applied = await runCommand(options(root, cdp, {
      restartImpl: async () => { ready = true; },
      args: ['--package-dir', 'package', '--state-dir', 'state', '--confirm-token', prepared.confirmToken, '--restart'],
    }), 'apply');
    assert.equal(applied.status, 'applied');
    assert.equal(applied.restarted, true);
    assert.ok(probes >= 3, 'restart apply must re-probe during DOM preflight and post-injection verification');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restart apply waits for DOM landmarks and verifies the injected theme before success', async () => {
  const root = await setup();
  try {
    const cdp = fakeCdp();
    const prepared = await runCommand(options(root, cdp), 'dry-run');
    const applied = await runCommand(options(root, cdp, {
      restartImpl: async () => {},
      args: ['--package-dir', 'package', '--state-dir', 'state', '--confirm-token', prepared.confirmToken, '--restart'],
    }), 'apply');
    assert.equal(applied.status, 'applied');
    const checks = cdp.calls.filter((expression) => expression.includes('missing'));
    assert.equal(checks.length, 3, 'apply must preflight, verify immediately, and verify again after a stability delay');
    assert.ok(cdp.calls.indexOf(checks[0]) < cdp.calls.findIndex((expression) => expression.includes('keeper.spec = spec')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('apply persists injection across document reloads and restore unregisters it', async () => {
  const root = await setup();
  try {
    const cdp = fakeCdp();
    const prepared = await runCommand(options(root, cdp), 'dry-run');
    await runCommand(options(root, cdp, {
      args: ['--package-dir', 'package', '--state-dir', 'state', '--confirm-token', prepared.confirmToken],
    }), 'apply');
    assert.equal(cdp.dom.installedScripts.length, 1);
    assert.match(cdp.dom.installedScripts[0], /workbuddy-skin-studio/);
    const state = JSON.parse(await readFile(join(root, 'state/runtime-state.json'), 'utf8'));
    assert.equal(state.newDocumentScriptId, 'persistent-script-1');

    await runCommand(options(root, cdp), 'restore');
    assert.deepEqual(cdp.dom.removedScripts, ['persistent-script-1']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('apply rejects a style node that produces no verified visual effect', async () => {
  const root = await setup();
  try {
    const cdp = fakeCdp();
    const originalEvaluate = cdp.evaluate.bind(cdp);
    cdp.evaluate = async (expression) => {
      const result = await originalEvaluate(expression);
      if (expression.includes('computedChecks') && cdp.dom.injected) {
        return { ...result, proof: false, visualApplied: false, computedChecks: [{ selector: '.teams-main-content', property: 'background-image', matched: false }] };
      }
      return result;
    };
    const prepared = await runCommand(options(root, cdp), 'dry-run');
    await assert.rejects(() => runCommand(options(root, cdp, {
      args: ['--package-dir', 'package', '--state-dir', 'state', '--confirm-token', prepared.confirmToken],
    }), 'apply'), /visual|computed|verification/i);
    assert.deepEqual(cdp.dom.removedScripts, ['persistent-script-1']);
    assert.equal(cdp.dom.injected, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('apply restores the official style and records failure when post-injection verification fails', async () => {
  const root = await setup();
  try {
    const cdp = fakeCdp();
    let checks = 0;
    const originalEvaluate = cdp.evaluate.bind(cdp);
    cdp.evaluate = async (expression) => {
      if (expression.includes('missing')) {
        cdp.calls.push(expression);
        checks += 1;
        if (checks === 1) return { style: false, dataAttribute: false, missing: [] };
        return { style: false, dataAttribute: false, missing: ['.chat-container'] };
      }
      return originalEvaluate(expression);
    };
    const prepared = await runCommand(options(root, cdp), 'dry-run');
    await assert.rejects(() => runCommand(options(root, cdp, {
      args: ['--package-dir', 'package', '--state-dir', 'state', '--confirm-token', prepared.confirmToken],
    }), 'apply'), /verification/i);
    assert.equal(cdp.dom.injected, false);
    assert.match(cdp.calls.at(-1), /removeAttribute/);
    const state = JSON.parse(await readFile(join(root, 'state/runtime-state.json'), 'utf8'));
    assert.equal(state.status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a persisted restart count above one is rejected before side effects', async () => {
  const root = await setup();
  try {
    const cdp = fakeCdp();
    const prepared = await runCommand(options(root, cdp), 'dry-run');
    const statePath = join(root, 'state/runtime-state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.restartCount = 2;
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    await assert.rejects(() => runCommand(options(root, cdp, { restartImpl: async () => { throw new Error('must not run'); }, args: ['--package-dir', 'package', '--state-dir', 'state', '--confirm-token', prepared.confirmToken, '--restart'] }), 'apply'), /restart/i);
    assert.equal(cdp.calls.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CDP probe enforces loopback and a valid WorkBuddy page target, but does not over-constrain identity', async () => {
  const base = { Browser: 'WorkBuddy/5.2.6', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/1' };
  const page = (url) => ({ type: 'page', url, webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1' });
  const fetchImpl = (responses) => async (url) => ({ ok: true, async json() { return responses[url.endsWith('/version') ? 'version' : 'list']; } });

  // Non-loopback renderer socket is rejected.
  await assert.rejects(() => probeCdp({ port: 9222, fetchImpl: fetchImpl({ version: base, list: [{ type: 'page', url: 'workbuddy://home', webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/1' }] }) }), /loopback/i);
  // Browser identity must be a valid /devtools/browser/<id> websocket.
  await assert.rejects(() => probeCdp({ port: 9222, fetchImpl: fetchImpl({ version: { Browser: 'WorkBuddy/5.2.6', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/json' }, list: [page('workbuddy://home')] }) }), /identity|browser/i);
  // At least one loopback page target is required.
  await assert.rejects(() => probeCdp({ port: 9222, fetchImpl: fetchImpl({ version: base, list: [{ type: 'background_page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/background/1' }] }) }), /page target/i);

  // The browser string need not contain "workbuddy" — any Electron/Chromium identity is
  // accepted because we trust the loopback port we ourselves launched WorkBuddy on.
  const chromeResult = await probeCdp({ port: 9222, fetchImpl: fetchImpl({ version: { Browser: 'Chrome/1.0', webSocketDebuggerUrl: base.webSocketDebuggerUrl }, list: [page('workbuddy://home')] }) });
  assert.equal(chromeResult.target.type, 'page');

  // Renderer path and multiple targets are accepted; the first page target is used.
  const many = await probeCdp({ port: 9222, fetchImpl: fetchImpl({ version: base, list: [page('file:///renderer/index.html'), page('workbuddy://chat')] }) });
  assert.equal(many.target.type, 'page');
});

test('CDP client can register a script for future documents', async () => {
  class FakeWebSocket {
    constructor() {
      this.listeners = new Map();
      queueMicrotask(() => this.listeners.get('open')?.({}));
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    send(raw) {
      const message = JSON.parse(raw);
      assert.equal(message.method, 'Page.addScriptToEvaluateOnNewDocument');
      queueMicrotask(() => this.listeners.get('message')?.({ data: JSON.stringify({ id: message.id, result: { identifier: 'script-42' } }) }));
    }
    close() {}
  }
  const client = new CdpClient({
    target: { webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/1' },
    WebSocketImpl: FakeWebSocket,
  });
  assert.deepEqual(await client.send('Page.addScriptToEvaluateOnNewDocument', { source: 'true' }), { identifier: 'script-42' });
});
