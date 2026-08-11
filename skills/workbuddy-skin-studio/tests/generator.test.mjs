import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const studio = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scripts = join(studio, 'scripts');
const tinyGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

async function fixtureArt(root, name = 'source.gif') {
  const path = join(root, name);
  await writeFile(path, tinyGif);
  return path;
}

function run(script, args, cwd = studio) {
  return spawnSync(process.execPath, [join(scripts, script), ...args], { cwd, encoding: 'utf8', timeout: 10000 });
}
function outputOf(result) { return `${result.stdout ?? ''}\n${result.stderr ?? ''}`; }
function json(result) { assert.equal(result.status, 0, outputOf(result)); return JSON.parse(result.stdout); }

test('生成器输出描述、视觉卡片、目标平台和声明式内层主题', async () => {
  const root = await mkdtemp('/tmp/wb-studio-generator-');
  const output = join(root, 'summer.wbtheme');
  try {
    const art = await fixtureArt(root);
    const generated = json(run('generate-theme-package.mjs', ['--id', 'summer-stage', '--name', '夏日舞台', '--description', '明亮、青春、天空蓝和暖黄色舞台光', '--art', art, '--targets', 'both', '--output', output]));
    assert.equal(generated.themeId, 'summer-stage');
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    const visual = JSON.parse(await readFile(join(output, 'analysis', 'visual-card.json'), 'utf8'));
    const theme = JSON.parse(await readFile(join(output, 'theme.codedrobe-theme', 'theme.json'), 'utf8'));
    const coreTheme = JSON.parse(await readFile(join(output, 'core-theme.codedrobe-theme'), 'utf8'));
    const corePackage = JSON.parse(await readFile(join(output, 'runtime', 'vendor', 'codedrobe-core', 'package.json'), 'utf8'));
    assert.deepEqual(manifest.targetPlatforms, ['macos', 'windows']);
    assert.match(visual.description, /明亮/);
    for (const field of ['palette', 'lighting', 'materials', 'motifs', 'readability']) assert.ok(field in visual);
    assert.equal(theme.targets.workbuddy.css, 'workbuddy.css');
    assert.equal(manifest.coreRuntimeVersion, '0.6.1');
    assert.equal(manifest.coreThemePackage, 'core-theme.codedrobe-theme');
    assert.equal(manifest.files.includes('core-theme.codedrobe-theme'), true);
    assert.equal(coreTheme.format, 'codedrobe-theme');
    assert.match(coreTheme.targets.workbuddy.css, /--cb-bg-primary/);
    assert.match(coreTheme.targets.workbuddy.css, /var\(--codedrobe-art\)/);
    assert.match(coreTheme.targets.workbuddy.css, /:is\(html\.codedrobe-host-workbuddy, html\[data-workbuddy-skin=/);
    assert.equal(corePackage.version, '0.6.1');
    assert.equal(manifest.files.includes('analysis/visual-card.json'), true);
    assert.equal(manifest.files.includes('使用手册.md'), true);
    assert.deepEqual(manifest.launchers, {
      macos: {
        apply: 'launchers/macos/Apply WorkBuddy Theme.app',
        restore: 'launchers/macos/Restore WorkBuddy Theme.app',
      },
      windows: {
        apply: 'launchers/windows/Apply WorkBuddy Theme.vbs',
        restore: 'launchers/windows/Restore WorkBuddy Theme.vbs',
      },
    });
    for (const relativePath of [
      'launchers/macos/Apply WorkBuddy Theme.app/Contents/Info.plist',
      'launchers/macos/Apply WorkBuddy Theme.app/Contents/MacOS/apply',
      'launchers/macos/Restore WorkBuddy Theme.app/Contents/MacOS/restore',
      'launchers/windows/Apply WorkBuddy Theme.vbs',
      'launchers/windows/Restore WorkBuddy Theme.vbs',
    ]) await access(join(output, relativePath));
    assert.match(await readFile(join(output, '使用手册.md'), 'utf8'), /重启并应用/);
    assert.equal(manifest.files.some((file) => /theme\.codedrobe-theme\/.*\.(?:js|mjs|cjs)$/.test(file)), false);
    const validated = json(run('validate-theme-package.mjs', ['--package-dir', output]));
    assert.equal(validated.pass, true);
    assert.deepEqual(json(run('validate-theme-package.mjs', ['--package-dir', output, '--platform', 'macos'])).targetPlatforms, ['macos', 'windows']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('summer sunset preset emits adaptive WorkBuddy palettes and toolbar styling', async () => {
  const root = await mkdtemp('/tmp/wb-studio-sunset-');
  const output = join(root, 'summer-sunset.wbtheme');
  try {
    const art = await fixtureArt(root);
    json(run('generate-theme-package.mjs', [
      '--id', 'summer-sunset', '--name', 'Summer Sunset', '--description', 'A calm summer shoreline at sunset.',
      '--art', art, '--targets', 'windows', '--output', output, '--preset', 'summer-sunset', '--appearance', 'adaptive',
      '--art-credit', 'Public-domain source image credit.',
    ]));
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    const css = await readFile(join(output, 'theme.codedrobe-theme', 'workbuddy.css'), 'utf8');
    const coreTheme = JSON.parse(await readFile(join(output, 'core-theme.codedrobe-theme'), 'utf8'));
    assert.equal(manifest.appearance, 'adaptive');
    assert.deepEqual(manifest.visualContract.modes.dark, {
      background: '#17213a', panel: '#202d49', text: '#fff8ef', muted: '#e8d3bb', accent: '#f4a261',
    });
    assert.deepEqual(manifest.visualContract.modes.light, {
      background: '#fff3e0', panel: '#fff9f1', text: '#3c2931', muted: '#735d62', accent: '#af4036',
    });
    assert.match(css, /@media \(prefers-color-scheme: light\)/);
    assert.match(css, /data-vscode-theme-kind/);
    assert.match(css, /\[role="toolbar"\]/);
    assert.match(css, /--wb-background: #17213a/);
    assert.match(css, /--wb-background: #fff3e0/);
    assert.match(coreTheme.targets.workbuddy.css, /--wb-accent-foreground/);
    await access(join(output, 'ATTRIBUTION.md'));
    assert.equal(manifest.files.includes('ATTRIBUTION.md'), true);
    assert.equal(json(run('validate-theme-package.mjs', ['--package-dir', output])).pass, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('打包器先校验并生成包内与包外 hash', async () => {
    const root = await mkdtemp('/tmp/wb-studio-pack-');
  const packageDir = join(root, 'pack.wbtheme');
  const zip = join(root, 'pack.wbtheme.zip');
  try {
    const art = await fixtureArt(root);
    json(run('generate-theme-package.mjs', ['--id', 'pack-stage', '--name', 'Pack Stage', '--description', 'A bright youth stage', '--art', art, '--targets', 'macos', '--output', packageDir]));
    await writeFile(join(packageDir, '.DS_Store'), 'Finder metadata\n', 'utf8');
    const packed = json(run('pack-theme-package.mjs', ['--package-dir', packageDir, '--output', zip]));
    assert.equal(await stat(zip).then(() => true), true);
    assert.equal(await stat(join(packageDir, 'checksums.sha256')).then(() => true), true);
    assert.equal(await stat(packed.externalChecksum).then(() => true), true);
    assert.equal(await stat(packed.checksumsFile).then(() => true), true);
    assert.equal(await stat(join(packageDir, 'launchers/macos/Apply WorkBuddy Theme.app/Contents/Resources/workbuddy-skin-package/manifest.json')).then(() => true), true);
    const checksums = await readFile(join(packageDir, 'checksums.sha256'), 'utf8');
    assert.match(checksums, /manifest\.json/);
    assert.doesNotMatch(checksums, /  checksums\.sha256$/m);
    const archive = outputOf(spawnSync('unzip', ['-l', zip], { encoding: 'utf8' }));
    assert.doesNotMatch(archive, /\.DS_Store/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('生成器支持 GIF 素材输入', async () => {
  const root = await mkdtemp('/tmp/wb-studio-gif-');
  const output = join(root, 'gif.wbtheme');
  const gifArt = join(root, 'stage.gif');
  try {
    await writeFile(gifArt, tinyGif);
    json(run('generate-theme-package.mjs', ['--id', 'gif-stage', '--name', 'GIF Stage', '--description', 'A bright youth stage', '--art', gifArt, '--targets', 'macos', '--output', output]));
    assert.equal(await stat(join(output, 'theme.codedrobe-theme', 'assets', 'art.gif')).then(() => true), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('生成器拒绝命令注入、密钥和不支持的目标平台', async () => {
  const root = await mkdtemp('/tmp/wb-studio-reject-');
  try {
    const art = await fixtureArt(root);
    for (const description of ['$(touch /tmp/pwned)', 'api_key=secret']) {
      const result = run('generate-theme-package.mjs', ['--id', 'unsafe-stage', '--name', 'Unsafe', '--description', description, '--art', art, '--targets', 'both', '--output', join(root, 'unsafe.wbtheme')]);
      assert.notEqual(result.status, 0, outputOf(result));
    }
    const platform = run('generate-theme-package.mjs', ['--id', 'linux-stage', '--name', 'Linux', '--description', 'safe', '--art', art, '--targets', 'linux', '--output', join(root, 'linux.wbtheme')]);
    assert.notEqual(platform.status, 0, outputOf(platform));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('validator 拒绝 visual-card 类型、必填字段和 manifest/target 不一致', async () => {
  const root = await mkdtemp('/tmp/wb-studio-validator-');
  const output = join(root, 'validator.wbtheme');
  try {
    const art = await fixtureArt(root);
    json(run('generate-theme-package.mjs', ['--id', 'validator-stage', '--name', 'Validator Stage', '--description', 'A valid description', '--art', art, '--targets', 'macos', '--output', output]));
    const visualPath = join(output, 'analysis', 'visual-card.json');
    const originalVisual = JSON.parse(await readFile(visualPath, 'utf8'));
    const invalidVisuals = [
      { ...originalVisual, materials: 'not-an-array' },
      { ...originalVisual, motifs: 42 },
      (() => { const visual = { ...originalVisual }; delete visual.description; return visual; })(),
    ];
    for (const visual of invalidVisuals) {
      await writeFile(visualPath, `${JSON.stringify(visual)}\n`, 'utf8');
      const result = run('validate-theme-package.mjs', ['--package-dir', output]);
      assert.notEqual(result.status, 0, `invalid visual-card should be rejected: ${outputOf(result)}`);
    }
    await writeFile(visualPath, `${JSON.stringify(originalVisual)}\n`, 'utf8');

    const manifestPath = join(output, 'manifest.json');
    const originalManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const [field, value] of [['themeId', 'different-id'], ['displayName', 'Different Name'], ['version', '9.9.9'], ['targetPlatforms', ['windows']]]) {
      const manifest = { ...originalManifest, [field]: value };
      await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
      const result = run('validate-theme-package.mjs', ['--package-dir', output]);
      assert.notEqual(result.status, 0, `${field} should be rejected: ${outputOf(result)}`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
