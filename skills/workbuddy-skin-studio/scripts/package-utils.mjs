import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';

export const PLATFORMS = new Set(['macos', 'windows']);
export const REQUIRED_LANDMARKS = ['home', 'chat', 'composer', 'sidebar', 'task', 'artifact'];
export const TEXT_EXTENSIONS = new Set(['.json', '.md', '.css', '.svg', '.html', '.yml', '.yaml', '.plist', '.command', '.ps1', '.psm1', '.bat', '.cmd', '.vbs', '.sh', '.txt', '.mjs', '.js']);

export function fail(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  throw error;
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) fail(`未知参数: ${token}`);
    const key = token.slice(2);
    if (key === 'help') { args.help = true; continue; }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail(`参数缺少值: --${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

export function safePackagePath(value, label = 'package path') {
  if (typeof value !== 'string' || !value || value.includes('\0')) fail(`${label} is invalid`);
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) fail(`${label} path must be relative; absolute path rejected`);
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..' || part === '')) fail(`${label} contains traversal`);
  if (parts.some((part) => part === '.' || part.includes('\0'))) fail(`${label} contains unsafe segment`);
  return parts.join('/');
}

export function assertPlatforms(value) {
  const platforms = value === 'both' ? ['macos', 'windows'] : String(value).split(',').map((v) => v.trim()).filter(Boolean);
  if (!platforms.length || platforms.some((p) => !PLATFORMS.has(p)) || new Set(platforms).size !== platforms.length) {
    fail('targetPlatforms must contain unique macos/windows values');
  }
  return platforms;
}

export function assertSafeText(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is required`);
  const suspicious = [
    /\$\(/, /`[^`]+`/, /;\s*(rm|del|chmod|curl|wget)\b/i, /&&\s*(invoke-expression|powershell|bash|sh)\b/i,
    /(?:api[_-]?key|secret|password|cookie|session|authorization|bearer)\s*[:=]/i,
    /\bbearer\s+[A-Za-z0-9._-]{8,}/i, /\bsk-[A-Za-z0-9_-]{8,}/, /(?:^|[\\/])Users[\\/]/i, /(?:^|[\\/])home[\\/]/i,
    /[A-Za-z]:[\\/]Users[\\/]/i,
  ];
  if (suspicious.some((pattern) => pattern.test(value))) fail(`${label} contains unsafe secret/path/command content; possible user path or absolute path`);
  return value.trim();
}

export function assertContained(root, target, label = 'path') {
  const rootAbs = resolve(root);
  const targetAbs = resolve(target);
  const rel = relative(rootAbs, targetAbs);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`${label} escapes package root`);
  return targetAbs;
}

export async function assertNoSymlink(path, label = path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) fail(`${label} must not be a symbolic link`);
}

export async function walkFiles(root) {
  const result = [];
  const rootReal = await realpath(resolve(root));
  async function visit(dir, relDir = '') {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.DS_Store') continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      safePackagePath(rel, 'file name');
      const absolute = resolve(dir, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) fail(`symlink/symbolic link is not allowed: ${rel}`);
      if (info.isDirectory()) await visit(absolute, rel);
      else if (info.isFile()) result.push({ rel, absolute, info });
      else fail(`unsupported filesystem entry: ${rel}`);
    }
  }
  await visit(resolve(root));
  const seen = new Set();
  for (const item of result) {
    const key = item.rel.toLocaleLowerCase('en-US');
    if (seen.has(key)) fail(`duplicate or case collision: ${item.rel}`);
    seen.add(key);
    const real = await realpath(item.absolute);
    assertContained(rootReal, real, `realpath ${item.rel}`);
  }
  return result;
}

export async function readJson(path, label = basename(path)) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { fail(`${label} is not valid JSON: ${error.message}`); }
}

export function isTextFile(rel) { return TEXT_EXTENSIONS.has(extname(rel).toLowerCase()) || basename(rel).toLowerCase() === 'readme.md'; }

export function contrastRatio(foreground, background) {
  const parse = (hex) => {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) fail(`invalid color: ${hex}`);
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  };
  const [r1, g1, b1] = parse(foreground);
  const [r2, g2, b2] = parse(background);
  const l1 = 0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1;
  const l2 = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2;
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function jsonOutput(payload, ok = true) {
  process.stdout.write(`${JSON.stringify({ pass: ok, ...payload }, null, 2)}\n`);
}

export function mainError(error) {
  process.stderr.write(`${JSON.stringify({ pass: false, error: error.message })}\n`);
  process.exitCode = 1;
}

// Portable, dependency-free ZIP writer (store / no compression).
// Used as a fallback when the `zip` CLI is unavailable (e.g. stock Windows).
// Filenames are written as UTF-8 with the language-encoding flag set so
// theme packages containing non-ASCII names (e.g. 使用手册.md) extract correctly.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const u16 = (n) => { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(n & 0xFFFF, 0); return b; };
const u32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

export async function packZipStore(files, outputPath) {
  const encoder = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const central = [];
  const push = (buf) => { chunks.push(buf); offset += buf.length; };

  for (const file of files) {
    const data = await readFile(file.absolute);
    const nameBuf = encoder.encode(file.rel);
    const crc = crc32(data);
    const localOffset = offset;

    push(Buffer.concat([
      u32(LOCAL_SIG), u16(20), u16(0x0800), u16(0), u16(0), u16(33),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf,
    ]));
    push(data);

    central.push(Buffer.concat([
      u32(CENTRAL_SIG), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(33),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(localOffset), nameBuf,
    ]));
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) { push(c); centralSize += c.length; }

  push(Buffer.concat([
    u32(EOCD_SIG), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(centralStart), u16(0),
  ]));

  await writeFile(outputPath, Buffer.concat(chunks));
}
