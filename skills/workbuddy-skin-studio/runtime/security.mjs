import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export function assertRelativePath(value, label = 'path') {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error(`${label} is invalid`);
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error(`${label} absolute path rejected`);
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`${label} traversal rejected`);
  return parts.join('/');
}

export function assertContained(root, target, label = 'path') {
  const rel = relative(resolve(root), resolve(target));
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} escapes root`);
  return resolve(target);
}

export async function assertNoSymlinkPath(path, label = path) {
  const absolute = resolve(path);
  const root = resolve('/');
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`${label} symbolic link rejected`);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
}

export async function resolveSafeChild(root, relativePath, label = 'path') {
  const safe = assertRelativePath(relativePath, label);
  const target = assertContained(root, join(root, safe), label);
  await assertNoSymlinkPath(target, label);
  return target;
}

export async function assertSafeTree(root) {
  const rootAbs = resolve(root);
  const rootInfo = await lstat(rootAbs);
  if (rootInfo.isSymbolicLink()) throw new Error('package root symbolic link rejected');
  const rootReal = await realpath(rootAbs);
  async function visit(dir) {
    const entries = await (await import('node:fs/promises')).readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const current = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic link rejected: ${entry.name}`);
      if (entry.isDirectory()) await visit(current);
      else if (entry.isFile()) {
        const real = await realpath(current);
        assertContained(rootReal, real, `realpath ${entry.name}`);
      } else throw new Error(`unsupported filesystem entry: ${entry.name}`);
    }
  }
  await visit(rootAbs);
  return rootReal;
}

export async function readJsonFile(path, label) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error.message}`); }
}

export async function requireRegularFile(path, label = path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  return stat(path);
}

export function assertNoSensitiveText(value, label = 'content') {
  const text = String(value);
  const patterns = [
    /(?:api[_-]?key|secret|password|cookie|session|authorization|bearer)\s*[:=]/i,
    /\bBearer\s+[A-Za-z0-9._-]{8,}/i,
    /\bsk-[A-Za-z0-9_-]{8,}/,
    /(?:^|[\\/])(?:Users|home)[\\/]/i,
    /[A-Za-z]:[\\/]Users[\\/]/i,
  ];
  if (patterns.some((pattern) => pattern.test(text))) throw new Error(`${label} contains sensitive data`);
}
