import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
test('macOS targets are present and do not edit app.asar before confirmation', async () => {
  for (const name of ['prepare.command', 'apply.command', 'verify.command', 'restore.command']) {
    const text = await readFile(`${root}/targets/macos/${name}`, 'utf8');
    assert.match(text, /runner\.mjs/); assert.doesNotMatch(text, /app\.asar/i);
    assert.match(text, /confirm|dry-run|prepare|apply|verify|restore/i);
  }
});

test('macOS includes a double-click app launcher without Terminal instructions', async () => {
  const app = `${root}/assets/launchers/macos/Apply WorkBuddy Theme.app`;
  const plist = await readFile(`${app}/Contents/Info.plist`, 'utf8');
  const executable = await readFile(`${app}/Contents/MacOS/apply`, 'utf8');
  assert.match(plist, /CFBundleExecutable/);
  assert.match(plist, /LSUIElement/);
  assert.match(executable, /osascript/);
  assert.match(executable, /\/usr\/bin\/dirname/);
  assert.match(executable, /Resources\/workbuddy-skin-package/);
  assert.match(executable, /WORKBUDDY_PACKAGE_DIR/);
  assert.doesNotMatch(executable, /Terminal|终端/);
  // Windows does not preserve POSIX execute bits when unpacking this bundle.
  if (process.platform !== 'win32') assert.ok((await stat(`${app}/Contents/MacOS/apply`)).mode & 0o111);
});

test('macOS restart launches Electron with loopback CDP flags instead of writing the app bundle', async () => {
 const runner = await readFile(`${root}/runtime/runner.mjs`, 'utf8');
  assert.match(runner, /spawnDetached/);
  assert.match(runner, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(runner, /--remote-debugging-port=/);
 assert.match(runner, /WORKBUDDY_REMOTE_DEBUGGING_PORT/);
  assert.match(runner, /waitForMacosExit/);
  assert.doesNotMatch(runner, /app\.asar/i);
});

test('Skill instructions describe the verified Electron and DOM validation chain', async () => {
  const skill = await readFile(`${root}/SKILL.md`, 'utf8');
  assert.doesNotMatch(skill, /open --env/);
  assert.match(skill, /Electron/);
  assert.match(skill, /DOM.*预检/);
  assert.match(skill, /新文档.*自动重新注入|页面重载.*重新注入/);
  assert.match(skill, /计算样式.*验证/);
  assert.match(skill, /失败.*恢复/);
});
