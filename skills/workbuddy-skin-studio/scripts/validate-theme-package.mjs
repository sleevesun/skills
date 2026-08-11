#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertContained, assertPlatforms, assertSafeText, contrastRatio, fail, isTextFile, mainError, parseArgs, readJson, REQUIRED_LANDMARKS, safePackagePath, walkFiles } from './package-utils.mjs';
import { assertNoSensitiveText } from '../runtime/security.mjs';

function collectStrings(value, output = []) { if (typeof value === 'string') output.push(value); else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, output)); else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, output)); return output; }
function checkUnsafeText(value, label) {
  const normalizedLabel = label.replaceAll('\\', '/');
  if (normalizedLabel.startsWith('runtime/vendor/codedrobe-core/') || normalizedLabel.includes('/runtime/vendor/codedrobe-core/')) return;
  if (normalizedLabel.startsWith('runtime/') || normalizedLabel.startsWith('targets/') || normalizedLabel.includes('/runtime/') || normalizedLabel.includes('/targets/')) {
    assertNoSensitiveText(value, label);
    return;
  }
  assertSafeText(value, label);
}
function parseCssColors(css) { const vars = {}; for (const match of css.matchAll(/--wb-([\w-]+)\s*:\s*(#[0-9a-f]{6})/gi)) vars[match[1]] = match[2]; return vars; }
function assertRatio(ratio, threshold, label) { if (!Number.isFinite(ratio) || ratio < threshold) fail(`${label} contrast ratio ${ratio.toFixed?.(2) ?? ratio} is below ${threshold}`); }
const TARGET_ENTRIES = {
  macos: ['prepare.command', 'apply.command', 'verify.command', 'restore.command'],
  windows: ['prepare.ps1', 'apply.ps1', 'verify.ps1', 'restore.ps1'],
};

function assertVisualCard(visual) {
  if (!visual || typeof visual !== 'object' || Array.isArray(visual)) fail('visual-card must be an object');
  for (const field of ['description', 'lighting']) {
    if (typeof visual[field] !== 'string' || !visual[field].trim()) fail(`visual-card ${field} must be a non-empty string`);
  }
  if (!visual.palette || typeof visual.palette !== 'object' || Array.isArray(visual.palette)) fail('visual-card palette must be an object');
  const paletteEntries = Object.entries(visual.palette);
  if (paletteEntries.length < 3) fail('visual-card palette must contain at least 3 colors');
  for (const [name, color] of paletteEntries) if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) fail(`visual-card palette.${name} must be a hex color`);
  for (const field of ['materials', 'motifs']) {
    if (!Array.isArray(visual[field]) || !visual[field].length || visual[field].some((value) => typeof value !== 'string' || !value.trim())) fail(`visual-card ${field} must be a non-empty string array`);
  }
  if (!visual.readability || typeof visual.readability !== 'object' || Array.isArray(visual.readability)) fail('visual-card readability must be an object');
  if (!visual.readability.wcag || typeof visual.readability.wcag !== 'object' || Array.isArray(visual.readability.wcag)) fail('visual-card readability.wcag must be an object');
}

function assertLaunchers(launchers, root, platforms, actual) {
  if (launchers === undefined) return;
  if (!launchers || typeof launchers !== 'object' || Array.isArray(launchers)) fail('manifest launchers must be an object');
  const actualSet = new Set(actual);
  for (const platform of Object.keys(launchers)) if (!platforms.includes(platform)) fail(`launcher platform is not declared: ${platform}`);
  for (const platform of platforms) {
    const config = launchers[platform];
    if (!config || typeof config !== 'object' || Array.isArray(config)) fail(`launcher config missing: ${platform}`);
    for (const action of ['apply', 'restore']) {
      const path = safePackagePath(config[action], `${platform} ${action} launcher`);
      assertContained(root, join(root, path), `${platform} ${action} launcher`);
      if (platform === 'macos') {
        if (!path.endsWith('.app')) fail(`macOS launcher must be an app bundle: ${path}`);
        const entry = action === 'apply' ? 'apply' : 'restore';
        if (!actualSet.has(`${path}/Contents/Info.plist`) || !actualSet.has(`${path}/Contents/MacOS/${entry}`)) fail(`macOS launcher bundle is incomplete: ${path}`);
      } else if (!path.endsWith('.vbs') || !actualSet.has(path)) {
        fail(`Windows launcher must be a VBS file: ${path}`);
      }
    }
  }
}

function assertCoreRequirements(requirements) {
  if (!Array.isArray(requirements) || !requirements.length) fail('Core theme verification.required is invalid');
  for (const requirement of requirements) {
    if (!requirement || typeof requirement.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(requirement.name)) fail('Core theme verification requirement name is invalid');
    if (!Array.isArray(requirement.any) || !requirement.any.length || requirement.any.some((selector) => typeof selector !== 'string' || !selector.trim())) fail('Core theme verification selector is invalid');
  }
}

function readVisualPalette(value, label, keys = ['background', 'text', 'accent']) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is invalid`);
  const colors = {};
  for (const key of keys) {
    const color = value[key];
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) fail(`${label}.${key} must be a hex color`);
    colors[key] = color.toLowerCase();
  }
  return colors;
}

function assertPaletteContrast(colors, label) {
  assertRatio(contrastRatio(colors.text, colors.background), 4.5, `${label} text/background`);
  assertRatio(contrastRatio(colors.text, colors.panel), 4.5, `${label} text/panel`);
  assertRatio(contrastRatio(colors.muted, colors.panel), 4.5, `${label} muted/panel`);
  assertRatio(contrastRatio(colors.accent, colors.panel), 3, `${label} accent/panel`);
}

async function assertPinnedCoreRuntime(manifest, root, actual) {
  const coreFields = ['coreThemePackage', 'coreRuntimeVersion', 'visualContract'];
  const declared = coreFields.filter((field) => Object.hasOwn(manifest, field));
  if (!declared.length) return;
  if (declared.length !== coreFields.length) fail('Core runtime manifest fields must be declared together');
  if (manifest.coreRuntimeVersion !== '0.6.1') fail('Core runtime version must be exactly 0.6.1');
  const coreThemePath = safePackagePath(manifest.coreThemePackage, 'Core theme package');
  if (!coreThemePath.endsWith('.codedrobe-theme') || !actual.includes(coreThemePath)) fail('Core theme package is missing');
  const colors = readVisualPalette(manifest.visualContract, 'visualContract');
  const palettes = [colors];
  if (Object.hasOwn(manifest.visualContract, 'modes')) {
    const modes = manifest.visualContract.modes;
    if (!modes || typeof modes !== 'object' || Array.isArray(modes)) fail('visualContract.modes is invalid');
    for (const mode of ['dark', 'light']) {
      const palette = readVisualPalette(modes[mode], `visualContract.modes.${mode}`, ['background', 'panel', 'text', 'muted', 'accent']);
      assertPaletteContrast(palette, `visualContract.modes.${mode}`);
      palettes.push(palette);
    }
  }
  const coreTheme = await readJson(join(root, coreThemePath), 'Core theme package');
  if (coreTheme.format !== 'codedrobe-theme' || coreTheme.schemaVersion !== 1) fail('Core theme package schema is invalid');
  if (coreTheme.theme?.id !== manifest.themeId || coreTheme.theme?.displayName !== manifest.displayName || coreTheme.theme?.version !== manifest.version) fail('Core theme identity does not match manifest');
  const target = coreTheme.targets?.workbuddy;
  if (!target || typeof target.css !== 'string' || !target.css.trim()) fail('Core WorkBuddy target is incomplete');
  if (/@import\s|url\(\s*["']?(?!data:)/i.test(target.css)) fail('Core CSS contains a remote resource');
  for (const token of ['--cb-bg-primary', '--cb-vscode-editor-background', '--cb-text-primary', '--cb-button-dark-background', 'var(--codedrobe-art)']) {
    if (!target.css.includes(token)) fail(`Core CSS is missing ${token}`);
  }
  for (const palette of palettes) for (const color of Object.values(palette)) if (!target.css.toLowerCase().includes(color)) fail(`Core CSS does not declare visual contract color ${color}`);
  assertCoreRequirements(target.verification?.required);
  const image = coreTheme.assets?.images?.hero;
  if (!image || typeof image.filename !== 'string' || !/^image\/(?:png|jpeg|webp|gif)$/.test(image.mimeType ?? '') || typeof image.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.base64)) fail('Core theme hero asset is invalid');
  const corePackagePath = 'runtime/vendor/codedrobe-core/package.json';
  if (!actual.includes(corePackagePath) || !actual.includes('runtime/vendor/codedrobe-core/src/index.mjs')) fail('pinned Core runtime files are missing');
  const corePackage = await readJson(join(root, corePackagePath), 'pinned Core package.json');
  if (corePackage.name !== '@codedrobe/core' || corePackage.version !== manifest.coreRuntimeVersion) fail('pinned Core package version is invalid');
}

async function validate(packageDir, requestedPlatform) {
  const root = resolve(packageDir);
  const files = await walkFiles(root);
  const manifest = await readJson(join(root, 'manifest.json'), 'manifest.json');
  const requiredManifest = ['schemaVersion', 'themeId', 'application', 'targetPlatforms', 'themePackage', 'runtimeVersion', 'requiresUserRestartConfirmation', 'files', 'security'];
  for (const field of requiredManifest) if (!(field in manifest)) fail(`manifest missing ${field}`);
  if (manifest.schemaVersion !== 1 || manifest.application !== 'workbuddy' || manifest.requiresUserRestartConfirmation !== true) fail('manifest contract is invalid');
  if (!Array.isArray(manifest.targetPlatforms)) fail('targetPlatforms must be an array');
  const platforms = assertPlatforms(manifest.targetPlatforms.join(','));
  if (requestedPlatform && !platforms.includes(requestedPlatform)) fail(`target platform mismatch: ${requestedPlatform}`);
  const security = manifest.security;
  if (!security || security.allowRemoteResources !== false || security.allowAppAsarWrites !== false || security.allowUserPaths !== false || security.allowSecrets !== false || security.declarationOnlyTheme !== true) fail('security policy is unsafe');
  if (manifest.install?.writes || collectStrings(manifest).some((v) => /app\.asar|\/Applications\/WorkBuddy\.app/i.test(v))) fail('package declares official app or app.asar writes');
  if (!Array.isArray(manifest.files)) fail('manifest files must be an array');
  const declared = manifest.files.map((file) => safePackagePath(file, 'manifest file'));
  const declaredKeys = new Set();
  for (const file of declared) { const key = file.toLocaleLowerCase('en-US'); if (declaredKeys.has(key)) fail(`duplicate manifest file: ${file}`); declaredKeys.add(key); }
  const actual = files.map((item) => item.rel).sort();
  const actualKeys = new Set(actual.map((file) => file.toLocaleLowerCase('en-US')));
  for (const file of declared) { if (!actualKeys.has(file.toLocaleLowerCase('en-US'))) fail(`manifest file not found: ${file}`); assertContained(root, join(root, file), `manifest file ${file}`); }
  for (const file of actual) if (!declaredKeys.has(file.toLocaleLowerCase('en-US'))) fail(`undeclared package file: ${file}`);
  assertLaunchers(manifest.launchers, root, platforms, actual);
  await assertPinnedCoreRuntime(manifest, root, actual);
  for (const textFile of files.filter((item) => isTextFile(item.rel))) checkUnsafeText(await readFile(textFile.absolute, 'utf8'), textFile.rel);
  const themePackage = safePackagePath(manifest.themePackage, 'theme package');
  assertContained(root, join(root, themePackage), 'theme package');
  const themePath = join(root, themePackage, 'theme.json');
  const theme = await readJson(themePath, 'theme.json');
  if (theme.schemaVersion !== 1 || typeof theme.id !== 'string' || typeof theme.displayName !== 'string' || typeof theme.version !== 'string') fail('theme.json schema is invalid');
  if (manifest.themeId !== theme.id || manifest.displayName !== theme.displayName || manifest.version !== theme.version) fail('manifest and theme.json identity fields must match');
  const targetEntries = new Set(files.filter((item) => item.rel.startsWith('targets/')).map((item) => item.rel));
  for (const platform of platforms) {
    const expected = TARGET_ENTRIES[platform].map((entry) => `targets/${platform}/${entry}`);
    for (const entry of expected) if (!targetEntries.has(entry)) fail(`target entry missing: ${entry}`);
  }
  for (const item of files.filter((entry) => entry.rel.startsWith('targets/'))) {
    const [, platform, entry] = item.rel.split('/');
    if (!platforms.includes(platform) || !TARGET_ENTRIES[platform]?.includes(entry)) fail(`target entry does not match targetPlatforms: ${item.rel}`);
  }
  const workbuddy = theme.targets?.workbuddy;
  if (!workbuddy || typeof workbuddy.css !== 'string' || !workbuddy.verification) fail('theme.json WorkBuddy target is incomplete');
  if (Object.hasOwn(workbuddy, 'required')) fail('theme.json verification.required must be nested under verification');
  safePackagePath(workbuddy.css, 'theme css');
  const required = workbuddy.verification.required;
  if (!Array.isArray(required) || required.some((v) => typeof v !== 'string' || !v.trim())) fail('required landmarks must be non-empty strings');
  for (const landmark of REQUIRED_LANDMARKS) if (!required.some((selector) => selector.includes(`=${landmark}]`))) fail(`required landmark missing: ${landmark}`);
  if (workbuddy.verification.recommended !== undefined && (!Array.isArray(workbuddy.verification.recommended) || workbuddy.verification.recommended.some((v) => typeof v !== 'string'))) fail('recommended landmarks schema invalid');
  if (workbuddy.verification.contexts !== undefined && (!Array.isArray(workbuddy.verification.contexts) || workbuddy.verification.contexts.some((v) => typeof v !== 'string'))) fail('contexts schema invalid');
  const cssPath = join(root, themePackage, workbuddy.css);
  const css = await readFile(cssPath, 'utf8');
  if (/@import\s+[^;]*url\s*\(|(?:https?:)?\/\//i.test(css) || /url\s*\(\s*['"]?(?:data:|javascript:)/i.test(css)) fail('CSS contains remote or tracking resource');
  const innerFiles = files.filter((item) => item.rel.startsWith(`${themePackage}/`));
  if (innerFiles.some((item) => /\.(?:js|mjs|cjs)$/i.test(item.rel))) fail('inner theme must be declarative and cannot contain executable scripts');
  const visualPath = join(root, 'analysis', 'visual-card.json');
  const visual = await readJson(visualPath, 'analysis/visual-card.json');
  assertVisualCard(visual);
  const colors = parseCssColors(css);
  for (const [name, color] of Object.entries(colors)) checkUnsafeText(color, `css color ${name}`);
  const normal = contrastRatio(colors.text, colors.background);
  const panel = contrastRatio(colors.text, colors.panel);
  const muted = contrastRatio(colors.muted, colors.panel);
  const ui = contrastRatio(colors.accent, colors.panel);
  assertRatio(normal, 4.5, 'normal text/background'); assertRatio(normal, 7, 'primary goal'); assertRatio(muted, 4.5, 'muted/panel'); assertRatio(ui, 3, 'UI/border/button');
  for (const text of collectStrings(visual)) checkUnsafeText(text, 'visual-card');
  const result = { packageDir: root, themeId: manifest.themeId, targetPlatforms: platforms, fileCount: actual.length, security: { declarationOnly: true, remoteResources: false, appAsarWrites: false }, wcag: { normalTextBackground: normal, primaryGoal: normal, mutedPanel: muted, ui }, platform: requestedPlatform ?? 'any' };
  return result;
}

try { const args = parseArgs(process.argv.slice(2)); if (!args['package-dir']) fail('--package-dir is required'); if (args.platform && !['macos', 'windows'].includes(args.platform)) fail('unsupported platform'); const result = await validate(args['package-dir'], args.platform); console.log(JSON.stringify({ pass: true, ...result }, null, 2)); }
catch (error) { mainError(error); }
