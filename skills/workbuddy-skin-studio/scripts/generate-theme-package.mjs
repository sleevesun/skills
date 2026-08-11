#!/usr/bin/env node
import { appendFile, copyFile, chmod, mkdir, writeFile, rm, lstat, readFile, readdir } from 'node:fs/promises';
import { extname, resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPlatforms, assertSafeText, contrastRatio, fail, parseArgs } from './package-utils.mjs';

const studioRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const launcherFiles = {
  macos: [
    ['assets/launchers/macos/Apply WorkBuddy Theme.app/Contents/Info.plist', 'launchers/macos/Apply WorkBuddy Theme.app/Contents/Info.plist'],
    ['assets/launchers/macos/Apply WorkBuddy Theme.app/Contents/MacOS/apply', 'launchers/macos/Apply WorkBuddy Theme.app/Contents/MacOS/apply'],
    ['assets/launchers/macos/Restore WorkBuddy Theme.app/Contents/Info.plist', 'launchers/macos/Restore WorkBuddy Theme.app/Contents/Info.plist'],
    ['assets/launchers/macos/Restore WorkBuddy Theme.app/Contents/MacOS/restore', 'launchers/macos/Restore WorkBuddy Theme.app/Contents/MacOS/restore'],
  ],
  windows: [
    ['assets/launchers/windows/Apply WorkBuddy Theme.vbs', 'launchers/windows/Apply WorkBuddy Theme.vbs'],
    ['assets/launchers/windows/Restore WorkBuddy Theme.vbs', 'launchers/windows/Restore WorkBuddy Theme.vbs'],
  ],
};

const THEME_PRESETS = {
  'neon-thunder': {
    appearance: 'dark',
    dark: {
      background: '#070815', panel: '#0d112b', surface: '#0b0d21', sidebar: '#0b0d21', composer: '#07091c',
      text: '#f5f3ff', muted: '#bcc4e8', accent: '#899bff', accentForeground: '#080a1d', line: 'rgba(171, 184, 255, .24)',
      toolbar: 'linear-gradient(180deg, rgba(7, 8, 21, .88), rgba(7, 8, 21, .28))',
      sidebarLayer: 'linear-gradient(180deg, rgba(16, 22, 55, .96), rgba(6, 7, 20, .98))',
      composerLayer: 'linear-gradient(145deg, rgba(18, 23, 57, .90), rgba(8, 10, 29, .88))',
      heroOverlay: 'linear-gradient(90deg, rgba(7, 8, 21, .97) 0%, rgba(9, 11, 30, .83) 34%, rgba(9, 11, 30, .34) 68%, rgba(7, 8, 21, .52) 100%), linear-gradient(180deg, rgba(7, 8, 21, .14), rgba(7, 8, 21, .68))',
      hover: 'rgba(137, 155, 255, .16)', selected: 'rgba(137, 155, 255, .26)', selection: 'rgba(137, 155, 255, .42)', shadow: 'rgba(2, 3, 14, .34)', headingShadow: 'rgba(3, 4, 16, .72)', scheme: 'dark',
    },
    visual: {
      lighting: 'Electric blue lightning, violet audience light, and warm stage spotlights.',
      materials: ['Metal stage truss', 'LED storm display', 'Fluorescent crowd lights', 'Soft floating balloons'],
      motifs: ['Lightning', 'Blue-violet glow', 'Live stage', 'Night sky'],
    },
  },
  'summer-sunset': {
    appearance: 'adaptive',
    dark: {
      background: '#17213a', panel: '#202d49', surface: '#18233d', sidebar: '#131d34', composer: '#1b2843',
      text: '#fff8ef', muted: '#e8d3bb', accent: '#f4a261', accentForeground: '#3b1f1a', line: 'rgba(244, 190, 131, .30)',
      toolbar: 'linear-gradient(180deg, rgba(23, 33, 58, .92), rgba(23, 33, 58, .58))',
      sidebarLayer: 'linear-gradient(180deg, rgba(22, 32, 57, .97), rgba(17, 26, 47, .96))',
      composerLayer: 'linear-gradient(145deg, rgba(37, 51, 81, .94), rgba(24, 35, 61, .94))',
      heroOverlay: 'linear-gradient(90deg, rgba(23, 33, 58, .97) 0%, rgba(28, 39, 66, .86) 36%, rgba(39, 47, 67, .38) 70%, rgba(23, 33, 58, .62) 100%), linear-gradient(180deg, rgba(19, 31, 54, .06), rgba(19, 28, 49, .72))',
      hover: 'rgba(244, 162, 97, .18)', selected: 'rgba(244, 162, 97, .30)', selection: 'rgba(244, 162, 97, .48)', shadow: 'rgba(4, 10, 24, .38)', headingShadow: 'rgba(4, 10, 24, .72)', scheme: 'dark',
    },
    light: {
      background: '#fff3e0', panel: '#fff9f1', surface: '#fce5ce', sidebar: '#fff7ec', composer: '#fffaf3',
      text: '#3c2931', muted: '#735d62', accent: '#af4036', accentForeground: '#fffaf3', line: 'rgba(145, 76, 63, .26)',
      toolbar: 'linear-gradient(180deg, rgba(255, 248, 237, .94), rgba(255, 242, 224, .72))',
      sidebarLayer: 'linear-gradient(180deg, rgba(255, 249, 241, .97), rgba(255, 238, 217, .95))',
      composerLayer: 'linear-gradient(145deg, rgba(255, 253, 248, .96), rgba(252, 229, 206, .94))',
      heroOverlay: 'linear-gradient(90deg, rgba(255, 248, 237, .97) 0%, rgba(255, 245, 229, .83) 36%, rgba(255, 236, 210, .36) 70%, rgba(255, 243, 224, .60) 100%), linear-gradient(180deg, rgba(255, 247, 232, .08), rgba(255, 238, 215, .58))',
      hover: 'rgba(209, 100, 69, .12)', selected: 'rgba(209, 100, 69, .20)', selection: 'rgba(209, 100, 69, .28)', shadow: 'rgba(124, 70, 54, .16)', headingShadow: 'rgba(255, 255, 255, .70)', scheme: 'light',
    },
    visual: {
      lighting: 'Late-summer sunset light moving from coral and amber into a calm blue evening.',
      materials: ['Warm sand', 'Ocean reflections', 'Translucent glass', 'Brushed brass controls'],
      motifs: ['Low sun', 'Gentle waves', 'Coral horizon', 'Summer shoreline'],
    },
  },
};

function resolveThemePreset(name, accent) {
  const preset = THEME_PRESETS[name];
  if (!preset) fail(`unsupported preset: ${name}`);
  return {
    name,
    appearance: preset.appearance,
    visual: preset.visual,
    dark: { ...preset.dark, accent: accent ?? preset.dark.accent },
    light: preset.light ? { ...preset.light } : null,
  };
}

function paletteDeclarations(palette) {
  return [
    `  --wb-background: ${palette.background};`,
    `  --wb-panel: ${palette.panel};`,
    `  --wb-surface: ${palette.surface};`,
    `  --wb-sidebar: ${palette.sidebar};`,
    `  --wb-composer: ${palette.composer};`,
    `  --wb-text: ${palette.text};`,
    `  --wb-muted: ${palette.muted};`,
    `  --wb-accent: ${palette.accent};`,
    `  --wb-accent-foreground: ${palette.accentForeground};`,
    `  --wb-line: ${palette.line};`,
    `  --wb-toolbar: ${palette.toolbar};`,
    `  --wb-sidebar-layer: ${palette.sidebarLayer};`,
    `  --wb-composer-layer: ${palette.composerLayer};`,
    `  --wb-hero-overlay: ${palette.heroOverlay};`,
    `  --wb-hover: ${palette.hover};`,
    `  --wb-selected: ${palette.selected};`,
    `  --wb-selection: ${palette.selection};`,
    `  --wb-shadow: ${palette.shadow};`,
    `  --wb-heading-shadow: ${palette.headingShadow};`,
    `  color-scheme: ${palette.scheme};`,
  ];
}

function buildWorkBuddyCss({ id, palette, artLayer, appearance }) {
  const host = `html.codedrobe-host-workbuddy, html[data-workbuddy-skin="${id}"]`;
  const body = `html.codedrobe-host-workbuddy body, html[data-workbuddy-skin="${id}"] body`;
  const workbuddyBody = `html.codedrobe-host-workbuddy body[data-application-name="workbuddy"], html[data-workbuddy-skin="${id}"] body`;
  const scope = `:is(html.codedrobe-host-workbuddy, html[data-workbuddy-skin="${id}"])`;
  const darkMode = ':is(.dark, .cb-dark, .vscode-dark, [data-vscode-theme-kind*="dark"])';
  const lightMode = ':is(.light, .cb-light, .vscode-light, [data-vscode-theme-kind*="light"])';
  const explicitDarkScope = `${scope}${darkMode}, ${scope}:has(body${darkMode})`;
  const explicitLightScope = `${scope}${lightMode}, ${scope}:has(body${lightMode})`;
  const systemLightScope = `${scope}:not(${darkMode}):not(:has(body${darkMode}))`;
  const modes = appearance === 'adaptive' ? [
    '',
    '@media (prefers-color-scheme: light) {',
    `  ${systemLightScope} {`,
    ...paletteDeclarations(palette.light),
    '  }',
    '}',
    '',
    explicitDarkScope + ' {',
    ...paletteDeclarations(palette.dark),
    '}',
    '',
    explicitLightScope + ' {',
    ...paletteDeclarations(palette.light),
    '}',
  ] : [];
  return [
    host + ' {',
    ...paletteDeclarations(palette.dark),
    '}',
    ...modes,
    '',
    workbuddyBody + ' {',
    '  --cb-bg-primary: var(--wb-background) !important;',
    '  --cb-bg-secondary: var(--wb-surface) !important;',
    '  --cb-sidebar-background: var(--wb-sidebar) !important;',
    '  --cb-panel-bg-primary: var(--wb-panel) !important;',
    '  --cb-text-primary: var(--wb-text) !important;',
    '  --cb-text-secondary: var(--wb-muted) !important;',
    '  --cb-vscode-editor-background: var(--wb-background) !important;',
    '  --cb-vscode-sideBar-background: var(--wb-sidebar) !important;',
    '  --cb-button-dark-background: var(--wb-accent) !important;',
    '  --cb-button-dark-foreground: var(--wb-accent-foreground) !important;',
    '  --vscode-editor-background: var(--wb-background) !important;',
    '  --vscode-editor-foreground: var(--wb-text) !important;',
    '  --vscode-sideBar-background: var(--wb-sidebar) !important;',
    '  --vscode-sideBar-foreground: var(--wb-text) !important;',
    '  --vscode-panel-background: var(--wb-panel) !important;',
    '  --vscode-input-background: var(--wb-composer) !important;',
    '  --vscode-input-border: var(--wb-line) !important;',
    '  --vscode-button-background: var(--wb-accent) !important;',
    '  --vscode-button-foreground: var(--wb-accent-foreground) !important;',
    '}',
    '',
    body + ' { background: var(--wb-background) !important; color: var(--wb-text) !important; }',
    '',
    scope + ' #root {',
    '  background-color: var(--wb-background) !important;',
    '  background-image: var(--wb-hero-overlay), ' + artLayer + ' !important;',
    '  background-position: center !important;',
    '  background-size: cover !important;',
    '  background-repeat: no-repeat !important;',
    '  color: var(--wb-text) !important;',
    '}',
    '',
    scope + ' :is(.teams-container, .teams-content-wrapper, .teams-main-content, .main-content, .main-content--welcome, .chat-container, ._cbChat_1akz6_7, [data-view-id]) {',
    '  background: transparent !important;',
    '  color: var(--wb-text) !important;',
    '}',
    '',
    scope + ' :is(.conversation-sidebar, .conversation-list, .conversation-list-content) {',
    '  background: var(--wb-sidebar-layer) !important;',
    '  color: var(--wb-text) !important;',
    '  border-right: 1px solid var(--wb-line) !important;',
    '}',
    '',
    scope + ' :is(.conversation-list-tab-button, .conversation-agent-card, .collapsible-section-header, .conversation-show-more-button):hover {',
    '  background: var(--wb-hover) !important;',
    '  color: var(--wb-text) !important;',
    '}',
    '',
    scope + ' :is(.conversation-list-tab-button.active, .conversation-list-tab-button-box.active, [aria-selected="true"]) {',
    '  background: var(--wb-selected) !important;',
    '  color: var(--wb-text) !important;',
    '}',
    '',
    scope + ' :is(.workbuddy-topbar, [role="toolbar"], [role="menubar"], .toolbar, .menubar, .workbench-menubar) {',
    '  background: var(--wb-toolbar) !important;',
    '  border-color: var(--wb-line) !important;',
    '  color: var(--wb-text) !important;',
    '  box-shadow: 0 10px 28px var(--wb-shadow) !important;',
    '  backdrop-filter: blur(14px) !important;',
    '}',
    scope + ' :is(.workbuddy-topbar, [role="toolbar"], [role="menubar"], .toolbar, .menubar, .workbench-menubar) :is(button, [role="button"], [role="menuitem"], a) { color: var(--wb-muted) !important; }',
    scope + ' :is(.workbuddy-topbar, [role="toolbar"], [role="menubar"], .toolbar, .menubar, .workbench-menubar) :is(button, [role="button"], [role="menuitem"], a):hover { background: var(--wb-hover) !important; color: var(--wb-text) !important; }',
    scope + ' :is(.workbuddy-topbar, [role="toolbar"], [role="menubar"], .toolbar, .menubar, .workbench-menubar) :is(svg, [role="img"]) { color: inherit !important; }',
    scope + ' :is(.workbuddy-topbar, [role="toolbar"], [role="menubar"], .toolbar, .menubar, .workbench-menubar) svg[stroke] { stroke: currentColor !important; }',
    scope + ' :is(.workbuddy-topbar, [role="toolbar"], [role="menubar"], .toolbar, .menubar, .workbench-menubar) svg:not([fill="none"]) { fill: currentColor !important; }',
    '',
    scope + ' :is(.wb-home-page, .wb-home-header, .teams-main-content, .chat-container) { color: var(--wb-text) !important; }',
    scope + ' :is(.wb-home-header h1, .wb-home-header h2, .wb-home-header h3, .wb-home-header p, .wb-home-header span) { color: var(--wb-text) !important; text-shadow: 0 3px 20px var(--wb-heading-shadow); }',
    '',
    scope + ' :is(.wb-home-composer, .composer-surface, [class*="composer" i][class*="surface" i]) {',
    '  background: var(--wb-composer-layer) !important;',
    '  border: 1px solid var(--wb-line) !important;',
    '  box-shadow: 0 26px 70px var(--wb-shadow) !important;',
    '  color: var(--wb-text) !important;',
    '}',
    '',
    scope + ' :is(input, textarea, [contenteditable="true"], [role="textbox"]) { color: var(--wb-text) !important; caret-color: var(--wb-accent) !important; }',
    scope + ' :is(input, textarea, [contenteditable="true"])::placeholder { color: var(--wb-muted) !important; }',
    scope + ' ::selection { background: var(--wb-selection); color: var(--wb-text); }',
    '',
  ].join('\n');
}

function contractPalette(palette) {
  return {
    background: palette.background,
    panel: palette.panel,
    text: palette.text,
    muted: palette.muted,
    accent: palette.accent,
  };
}

function paletteReadability(palette) {
  const rounded = (ratio) => Number(contrastRatio(...ratio).toFixed(2));
  return {
    normalTextBackground: rounded([palette.text, palette.background]),
    primaryGoal: rounded([palette.text, palette.background]),
    mutedPanel: rounded([palette.muted, palette.panel]),
    ui: rounded([palette.accent, palette.panel]),
    thresholds: { normalTextBackground: 4.5, primaryGoal: 7, mutedPanel: 4.5, ui: 3 },
  };
}

function mimeTypeFor(extension) {
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[extension] ?? null;
}

async function copyTree(source, destination, packageRoot, files) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) fail(`runtime dependency contains a symbolic link: ${source}`);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      await copyTree(join(source, entry.name), join(destination, entry.name), packageRoot, files);
    }
    return;
  }
  if (!info.isFile()) fail(`runtime dependency contains an unsupported entry: ${source}`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  files.push(relative(packageRoot, destination).replaceAll('\\', '/'));
}

async function copyPinnedCoreRuntime(output, files) {
  const coreRoot = join(studioRoot, 'node_modules', '@codedrobe', 'core');
  const packageJson = JSON.parse(await readFile(join(coreRoot, 'package.json'), 'utf8'));
  if (packageJson.version !== '0.6.1') fail('installed @codedrobe/core must be exactly 0.6.1');
  const destination = join(output, 'runtime', 'vendor', 'codedrobe-core');
  for (const entry of ['package.json', 'LICENSE', 'NOTICE', 'src']) {
    await copyTree(join(coreRoot, entry), join(destination, entry), output, files);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log('generate-theme-package --id --name --description --art --targets --output [--accent] [--preset] [--appearance] [--art-credit]'); process.exit(0); }

try {
  const id = assertSafeText(args.id, 'id');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) fail('id must be lowercase kebab-case');
  const name = assertSafeText(args.name, 'name');
  const description = assertSafeText(args.description, 'description');
  const targets = assertPlatforms(args.targets);
  if (!args.art) fail('--art is required');
  const art = resolve(args.art);
  const artInfo = await lstat(art);
  if (!artInfo.isFile() || artInfo.isSymbolicLink()) fail('--art must be a regular non-symlink file');
  const artExtension = extname(art).toLowerCase();
  if (!new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']).has(artExtension)) fail('art must be png, jpg, jpeg, webp, or gif');
  const output = resolve(args.output ?? `${id}.wbtheme`);
  if (output === resolve('/') || output.includes(`${join('Contents', 'Resources', 'app.asar')}`)) fail('unsafe output path');
  await rm(output, { recursive: true, force: true });
  const inner = join(output, 'theme.codedrobe-theme');
  await mkdir(join(inner, 'assets'), { recursive: true });
  await mkdir(join(output, 'analysis'), { recursive: true });
  for (const platform of targets) await mkdir(join(output, 'targets', platform), { recursive: true });

  const requestedAccent = args.accent;
  if (requestedAccent && !/^#[0-9a-f]{6}$/i.test(requestedAccent)) fail('--accent must be a six-digit hex color');
  const preset = resolveThemePreset(args.preset ?? 'neon-thunder', requestedAccent);
  const appearance = args.appearance ?? preset.appearance;
  if (!new Set(['dark', 'adaptive']).has(appearance)) fail('--appearance must be dark or adaptive');
  if (appearance === 'adaptive' && !preset.light) fail(`preset ${preset.name} does not include a light palette`);
  const artCredit = args['art-credit'] ? assertSafeText(args['art-credit'], 'art-credit') : null;
  const artName = `art${artExtension === '.jpeg' ? '.jpg' : artExtension}`;
  const artMimeType = mimeTypeFor(artExtension);
  if (!artMimeType) fail('unsupported art MIME type');
  const artBuffer = await readFile(art);
  await copyFile(art, join(inner, 'assets', artName));
  const themedCss = buildWorkBuddyCss({ id, palette: preset, appearance, artLayer: `url("./assets/${artName}")` });
  const coreCss = buildWorkBuddyCss({ id, palette: preset, appearance, artLayer: 'var(--codedrobe-art)' });
  await writeFile(join(inner, 'workbuddy.css'), themedCss, 'utf8');
  const theme = {
    schemaVersion: 1, id, displayName: name, version: '1.0.0',
    targets: { workbuddy: { css: 'workbuddy.css', verification: {
      required: ['.wb-home-page, [data-wb-landmark=home]', '.chat-container, [data-wb-landmark=chat]', '.wb-home-composer, .composer-surface, [data-wb-landmark=composer]', '.conversation-sidebar, [data-wb-landmark=sidebar]', '[class*="task" i], [data-wb-landmark=task]', '.teams-main-content, [class*="result" i], [class*="artifact" i], [data-wb-landmark=artifact]'],
      recommended: ['.workbuddy-topbar, [data-wb-landmark=header]', 'body::before, [data-wb-landmark=hero]'], contexts: ['home', 'chat', 'task', 'artifact'],
    } } },
  };
  await writeFile(join(inner, 'theme.json'), `${JSON.stringify(theme, null, 2)}\n`, 'utf8');
  const coreTheme = {
    format: 'codedrobe-theme',
    schemaVersion: 1,
    theme: { id, displayName: name, version: '1.0.0', copy: { tagline: description } },
    targets: {
      workbuddy: {
        css: coreCss,
        verification: {
          required: [{ name: 'workbuddy-shell', any: ['#root > .teams-container', '.teams-container', '#root'] }],
          recommended: [
            { name: 'sidebar', any: ['.conversation-sidebar', '.conversation-list'] },
            { name: 'workspace', any: ['.teams-main-content', '.main-content', '.chat-container'] },
            { name: 'composer', any: ["[role='textbox'][contenteditable='true']", ".wb-home-composer [contenteditable='true']"] },
          ],
        },
      },
    },
    assets: { images: { hero: { filename: artName, mimeType: artMimeType, base64: artBuffer.toString('base64') } } },
  };
  const coreThemeSerialized = `${JSON.stringify(coreTheme, null, 2)}\n`;
  if (Buffer.byteLength(coreThemeSerialized) > 30 * 1024 * 1024) fail('art is too large for the Core theme package');
  await writeFile(join(output, 'core-theme.codedrobe-theme'), coreThemeSerialized, 'utf8');
  const visual = {
    description,
    palette: contractPalette(preset.dark),
    lighting: preset.visual.lighting,
    materials: preset.visual.materials,
    motifs: preset.visual.motifs,
    readability: { wcag: paletteReadability(preset.dark), modes: appearance === 'adaptive' ? { dark: paletteReadability(preset.dark), light: paletteReadability(preset.light) } : undefined },
  };
  await writeFile(join(output, 'analysis', 'visual-card.json'), `${JSON.stringify(visual, null, 2)}\n`, 'utf8');
  const escapeXml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const preview = preset.name === 'summer-sunset' ? [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',
    '<defs><linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1b2a4a"/><stop offset=".47" stop-color="#e06d4a"/><stop offset="1" stop-color="#f4c77a"/></linearGradient><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#254d68"/><stop offset="1" stop-color="#16243e"/></linearGradient><radialGradient id="sun"><stop stop-color="#fff6c4"/><stop offset=".55" stop-color="#f5b65d"/><stop offset="1" stop-color="#e06d4a" stop-opacity="0"/></radialGradient></defs>',
    '<rect width="1200" height="630" fill="url(#sky)"/>',
    '<rect y="344" width="1200" height="286" fill="url(#sea)"/>',
    '<circle cx="890" cy="208" r="178" fill="url(#sun)"/>',
    '<circle cx="890" cy="208" r="76" fill="#ffe29a" opacity=".94"/>',
    '<path d="M0 408 C180 370 312 446 492 406 S824 366 1200 410" fill="none" stroke="#9ed7d3" stroke-opacity=".52" stroke-width="6"/>',
    '<path d="M0 478 C186 438 350 514 570 470 S940 442 1200 486" fill="none" stroke="#f4c77a" stroke-opacity=".36" stroke-width="4"/>',
    '<rect x="72" y="332" width="1056" height="208" rx="24" fill="#17213a" fill-opacity=".82" stroke="#f4a261" stroke-opacity=".72" stroke-width="2"/>',
    '<text x="72" y="104" font-family="sans-serif" font-size="24" fill="#fff3e0">WORKBUDDY SKIN STUDIO</text>',
    '<text x="72" y="190" font-family="sans-serif" font-size="52" font-weight="700" fill="#fff8ef">' + escapeXml(name) + '</text>',
    '<text x="72" y="248" font-family="sans-serif" font-size="24" fill="#fff3e0">' + escapeXml(description) + '</text>',
    '<text x="110" y="412" font-family="sans-serif" font-size="28" fill="#fff8ef">' + escapeXml(targets.join(' · ')) + '</text>',
    '<text x="110" y="462" font-family="sans-serif" font-size="21" fill="#e8d3bb">Summer sunset · adaptive light and dark palettes · local artwork</text>',
    '<rect x="110" y="486" width="76" height="24" rx="12" fill="#fff3e0"/><rect x="196" y="486" width="76" height="24" rx="12" fill="#17213a" stroke="#f4a261" stroke-width="2"/>',
    '</svg>',
  ].join('') : [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',
    '<defs><linearGradient id="night" x1="0" x2="1"><stop stop-color="#070815"/><stop offset=".58" stop-color="#10183c"/><stop offset="1" stop-color="#071126"/></linearGradient><radialGradient id="bolt"><stop stop-color="#ced7ff"/><stop offset=".35" stop-color="#7188ff"/><stop offset="1" stop-color="#182454" stop-opacity="0"/></radialGradient></defs>',
    '<rect width="1200" height="630" fill="url(#night)"/>',
    '<circle cx="930" cy="135" r="245" fill="url(#bolt)" opacity=".56"/>',
    '<path d="M800 0 L705 245 L792 245 L678 530 L925 205 L818 205 Z" fill="#9eaeff" opacity=".72"/>',
    '<rect x="72" y="332" width="1056" height="208" rx="30" fill="#0b0f29" fill-opacity=".78" stroke="#7e91f6" stroke-opacity=".55" stroke-width="2"/>',
    '<text x="72" y="104" font-family="sans-serif" font-size="24" fill="#bcc4e8">WORKBUDDY SKIN STUDIO</text>',
    '<text x="72" y="190" font-family="sans-serif" font-size="52" font-weight="700" fill="#f5f3ff">' + escapeXml(name) + '</text>',
    '<text x="72" y="248" font-family="sans-serif" font-size="24" fill="#bcc4e8">' + escapeXml(description) + '</text>',
    '<text x="110" y="420" font-family="sans-serif" font-size="28" fill="#f5f3ff">' + escapeXml(targets.join(' · ')) + '</text>',
    '<text x="110" y="472" font-family="sans-serif" font-size="21" fill="#bcc4e8">Global stage background · dark control panels · restart only after confirmation</text>',
    '</svg>',
  ].join('');
  await writeFile(join(output, 'preview.svg'), preview, 'utf8');
  const modeNote = appearance === 'adaptive' ? '\n\n## 浅色与深色模式\n\n主题会优先识别 WorkBuddy 自身的 light/dark、cb-light/cb-dark、vscode-light/vscode-dark 与 VS Code 主题标记；只有没有应用标记时才跟随系统偏好。文字、图标、菜单栏和工具栏均使用对应模式的语义颜色。\n' : '';
  const creditNote = artCredit ? `\n\n## 图片来源\n\n${artCredit}\n` : '';
  await writeFile(join(output, 'README.md'), `# ${name}\n\n${description}\n\n这是 WorkBuddy 声明式主题包，目标平台：${targets.join('、')}。本包不会修改 app.asar。${modeNote}\n\n## 无需终端：双击启动\n\n解压后直接启动对应平台的文件即可应用主题；启动器会先校验包，再显示“重启并应用”确认。\n\n${targets.includes('macos') ? '- macOS：双击 launchers/macos/Apply WorkBuddy Theme.app。\n' : ''}${targets.includes('windows') ? '- Windows：双击 launchers/windows/Apply WorkBuddy Theme.vbs。\n' : ''}\n需要恢复官方样式时，双击对应的 Restore 启动器。高级用户仍可使用 targets 目录中的入口。\n\n## 使用顺序\n\n1. 双击平台启动器；不需要打开终端或手动输入命令。\n2. 启动器先校验包完整性和 WorkBuddy 页面地标。\n3. 在系统确认框中选择“重启并应用”；取消不会重启。\n4. 应用完成后可使用 Verify 入口复核。\n5. 需要恢复官方样式时使用 Restore 启动器。${creditNote}\n\n详细的 macOS/Windows 依赖、版权和安全边界请阅读同目录的“使用手册.md”。\n`, 'utf8');
  await writeFile(join(output, '使用手册.md'), `# ${name} 使用手册\n\n## 适用范围\n\n本包是 WorkBuddy 的跨平台主题包，目标平台为：${targets.join('、')}。它只注入本地声明式 CSS 和图片，不修改 WorkBuddy 的 app.asar，也不会联网下载资源。\n\n## 推荐方式：双击启动，不需要终端\n\n1. 解压主题包。\n2. macOS 双击 launchers/macos/Apply WorkBuddy Theme.app；Windows 双击 launchers/windows/Apply WorkBuddy Theme.vbs。\n3. 启动器先完成本地校验，然后显示系统确认框。\n4. 只有选择“重启并应用”后才会重启 WorkBuddy；选择取消不会重启。\n5. 应用完成后可双击 Verify 入口复核；恢复官方样式时双击 Restore 启动器。\n\nWindows 启动器使用包内固定的 CodeDrobe Core 运行时，要求本机已安装 Node.js 22.4 或更高版本。它不会回退到 WorkBuddy 自带的 Electron Node 模式；缺少独立 Node.js 时会显示错误提示并停止。\n\n## 高级入口\n\n- macOS：targets/macos/verify.command、prepare.command、apply.command、restore.command。\n- Windows：targets/windows/verify.ps1、prepare.ps1、apply.ps1、restore.ps1。\n\n## 失败处理\n\n如果校验、应用识别、CDP 地标、真实 CSS 变量或校验和失败，请停止操作并保留错误信息；不要绕过验证。当前包的 macOS 仍需目标电脑实机验证，Windows 每次应用都会执行本机实测验证。\n`, 'utf8');
  if (artCredit) await writeFile(join(output, 'ATTRIBUTION.md'), `# Image attribution\n\n${artCredit}\n`, 'utf8');
  const files = ['manifest.json', 'README.md', '使用手册.md', 'preview.svg', 'analysis/visual-card.json', 'core-theme.codedrobe-theme', 'theme.codedrobe-theme/theme.json', 'theme.codedrobe-theme/workbuddy.css', `theme.codedrobe-theme/assets/${artName}`, ...(artCredit ? ['ATTRIBUTION.md'] : [])];
  const targetEntries = { macos: ['prepare.command', 'apply.command', 'verify.command', 'restore.command'], windows: ['prepare.ps1', 'apply.ps1', 'verify.ps1', 'restore.ps1'] };
  await appendFile(join(output, '使用手册.md'), '\n## 运行状态\n\n运行状态默认写入用户应用数据目录，不写回主题包，因此应用后的包仍可通过校验并重复分发。\n', 'utf8');
  for (const platform of targets) {
    for (const entry of targetEntries[platform]) {
      await copyFile(join(studioRoot, 'targets', platform, entry), join(output, 'targets', platform, entry));
      if (platform === 'macos') await chmod(join(output, 'targets', platform, entry), 0o755);
      files.push(`targets/${platform}/${entry}`);
    }
    for (const [source, destination] of launcherFiles[platform]) {
      const target = join(output, destination);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(studioRoot, source), target);
      if (platform === 'macos' && (destination.endsWith('/apply') || destination.endsWith('/restore'))) await chmod(target, 0o755);
      files.push(destination);
    }
  }
  const runtimeEntries = [
    'runtime/runner.mjs', 'runtime/core-runner.mjs', 'runtime/cdp.mjs', 'runtime/security.mjs', 'runtime/state-machine.mjs', 'runtime/run-node.command', 'runtime/run-node.ps1', 'runtime/run-node-windows.ps1', 'runtime/VERSION', 'runtime/NOTICE',
    'runtime/adapters/NOTICE', 'runtime/adapters/local-cdp.mjs', 'runtime/adapters/codedrobe-core.mjs',
  ];
  for (const entry of runtimeEntries) {
    const target = join(output, entry);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(studioRoot, entry), target);
    if (entry.endsWith('.command')) await chmod(target, 0o755);
    files.push(entry);
  }
  await copyPinnedCoreRuntime(output, files);
  files.sort();
  const launchers = {};
  if (targets.includes('macos')) launchers.macos = { apply: 'launchers/macos/Apply WorkBuddy Theme.app', restore: 'launchers/macos/Restore WorkBuddy Theme.app' };
  if (targets.includes('windows')) launchers.windows = { apply: 'launchers/windows/Apply WorkBuddy Theme.vbs', restore: 'launchers/windows/Restore WorkBuddy Theme.vbs' };
  const visualContract = { ...contractPalette(preset.dark), ...(appearance === 'adaptive' ? { modes: { dark: contractPalette(preset.dark), light: contractPalette(preset.light) } } : {}) };
  const manifest = { schemaVersion: 1, themeId: id, application: 'workbuddy', displayName: name, version: '1.0.0', description, targetPlatforms: targets, deliveryMode: 'portable-double-click', launchers, themePackage: 'theme.codedrobe-theme', runtimeVersion: '1.0.0', coreThemePackage: 'core-theme.codedrobe-theme', coreRuntimeVersion: '0.6.1', appearance, visualContract, requiresUserRestartConfirmation: true, files, security: { allowRemoteResources: false, allowAppAsarWrites: false, allowUserPaths: false, allowSecrets: false, declarationOnlyTheme: true }, compatibility: { macos: { status: 'pending-live-verification', workbuddy: 'unknown' }, windows: { status: 'requires-local-verification', workbuddy: '5.2.6' } } };
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ pass: true, output, themeId: id, targetPlatforms: targets, files: files.length }, null, 2));
} catch (error) { console.error(JSON.stringify({ pass: false, error: error.message })); process.exitCode = 1; }
