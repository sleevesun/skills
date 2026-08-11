import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
test('Windows targets use PowerShell-safe Windows commands only', async () => {
  for (const name of ['prepare.ps1', 'apply.ps1', 'verify.ps1', 'restore.ps1']) {
    const text = await readFile(`${root}/targets/windows/${name}`, 'utf8');
    assert.match(text, /core-runner\.mjs/); assert.match(text, /run-node-windows\.ps1/); assert.doesNotMatch(text, /\.command|osascript|open -a|\/Applications|app\.asar/i);
    assert.match(text, /confirm|dry-run|prepare|apply|verify|restore/i);
  }
});

test('Windows includes a hidden double-click launcher and native confirmation', async () => {
  const launcher = await readFile(`${root}/assets/launchers/windows/Apply WorkBuddy Theme.vbs`, 'utf8');
  const apply = await readFile(`${root}/targets/windows/apply.ps1`, 'utf8');
  assert.match(launcher, /powershell\.exe/i);
  assert.match(launcher, /-WindowStyle Hidden/i);
  assert.match(apply, /MessageBox|System\.Windows\.Forms/i);
  assert.doesNotMatch(apply, /PromptForChoice/);
});

test('Windows VBS launchers are codepage-safe and avoid single-line conditional parsing', async () => {
  for (const name of ['Apply WorkBuddy Theme.vbs', 'Restore WorkBuddy Theme.vbs']) {
    const launcher = await readFile(`${root}/assets/launchers/windows/${name}`, 'utf8');
    assert.doesNotMatch(launcher, /[^\x09\x0A\x0D\x20-\x7E]/, `${name} must remain ASCII for Windows Script Host`);
    assert.match(launcher, /If exitCode <> 0 Then\r?\n[\s\S]*?\r?\nEnd If/);
    assert.doesNotMatch(launcher, /Then[ \t]+MsgBox/);
  }
});

test('Windows launcher PowerShell stays ASCII for Windows PowerShell 5.1', async () => {
  for (const name of ['prepare.ps1', 'apply.ps1', 'verify.ps1', 'restore.ps1']) {
    const script = await readFile(`${root}/targets/windows/${name}`, 'utf8');
    assert.doesNotMatch(script, /[^\x09\x0A\x0D\x20-\x7E]/, `${name} must remain ASCII to avoid legacy codepage corruption`);
  }
});

test('Windows Core runtime requires standalone Node instead of WorkBuddy Electron fallback', async () => {
  const nodeRunner = await readFile(`${root}/runtime/run-node-windows.ps1`, 'utf8');
  assert.match(nodeRunner, /Node\.js 22\.4 or newer/);
  assert.match(nodeRunner, /Resolve-NodeRuntime/);
  assert.doesNotMatch(nodeRunner, /ELECTRON_RUN_AS_NODE|Electron\s*=\s*\$true/i);
});

test('Windows restart launches the signed WorkBuddy executable directly with CDP flags', async () => {
  const runner = await readFile(`${root}/runtime/runner.mjs`, 'utf8');
  assert.match(runner, /Get-AppxPackage/);
  assert.match(runner, /InstallLocation/);
  assert.match(runner, /Get-AuthenticodeSignature/);
  assert.match(runner, /Start-Process -FilePath \$app -ArgumentList \$arguments/);
  assert.doesNotMatch(runner, /shell:AppsFolder|Get-StartApps/);
});

test('Windows restart preserves the bundled-Electron runtime that performs injection', async () => {
  const runner = await readFile(`${root}/runtime/runner.mjs`, 'utf8');
  assert.match(runner, /WORKBUDDY_SKIN_RUNTIME_PID: String\(process\.pid\)/);
  assert.match(runner, /WORKBUDDY_SKIN_RUNTIME_PID is invalid/);
  assert.match(runner, /\$_\.ProcessId -ne \$runtimePid/);
});

test('Windows apply launcher reports verified success and surfaces runtime failures', async () => {
  const apply = await readFile(`${root}/targets/windows/apply.ps1`, 'utf8');
  assert.match(apply, /Theme applied and verified successfully/);
  assert.match(apply, /2>&1/);
  assert.match(apply, /throw/);
  assert.match(apply, /--watch/);
});

test('Windows Core runner applies, watches, and verifies real WorkBuddy visual contract values', async () => {
  const runner = await readFile(`${root}/runtime/core-runner.mjs`, 'utf8');
  assert.match(runner, /applySkin/);
  assert.match(runner, /watchTheme/);
  assert.match(runner, /verifyTheme/);
  assert.match(runner, /stopWorkBuddyProcesses/);
  assert.match(runner, /taskkill\.exe/);
  assert.doesNotMatch(runner, /\['\/F', '\/T'/);
  assert.match(runner, /--cb-bg-primary/);
  assert.match(runner, /--cb-vscode-editor-background/);
  assert.match(runner, /checksums\.sha256 is required/);
  assert.match(runner, /restoreSkin/);
});

test('Windows Core runner supersedes only a verified prior theme watcher after confirmation', async () => {
  const runner = await readFile(`${root}/runtime/core-runner.mjs`, 'utf8');
  assert.match(runner, /readCompetingWatcherStates/);
  assert.match(runner, /Get-CimInstance Win32_Process/);
  assert.match(runner, /UTF8Encoding/);
  assert.match(runner, /isVerifiedCoreWatcher/);
  assert.match(runner, /commandLine\.includes\(expectedRunner\)/);
  assert.match(runner, /commandLine\.includes\(expectedStateDir\)/);
  const confirmed = runner.indexOf("await saveState(stateDir, confirmed)");
  const handoff = runner.indexOf('await stopCompetingWatchers(packageInfo.root)');
  const restart = runner.indexOf('await launchWorkBuddy(adapter, port)');
  assert.ok(confirmed >= 0 && handoff > confirmed && restart > handoff, 'watcher handoff must occur only after confirmation and before restart');
});

test('Windows target runners stay hidden after the VBS handoff', async () => {
  for (const name of ['prepare.ps1', 'apply.ps1', 'verify.ps1', 'restore.ps1']) {
    const text = await readFile(root + '/targets/windows/' + name, 'utf8');
    assert.doesNotMatch(text, /powershell\.exe\s+-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-File/i);
  }
});
