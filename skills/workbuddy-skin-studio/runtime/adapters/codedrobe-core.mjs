import { readFile } from 'node:fs/promises';

// The core is intentionally an installed, pinned dependency. It is never fetched or executed via npx.
export const FIXED_VERSION = '0.6.1';
export const NETWORK_DISABLED = true;
export const INSTALL_MODE = 'local-only';

export async function loadCodedrobeCore(coreRoot, expectedVersion = FIXED_VERSION) {
  if (!coreRoot || typeof coreRoot !== 'string' || coreRoot.startsWith('-')) throw new Error('codedrobe-core local installation is required');
  if (expectedVersion !== FIXED_VERSION) throw new Error(`codedrobe-core version must be ${FIXED_VERSION}`);
  let manifest;
  try { manifest = JSON.parse(await readFile(`${coreRoot}/package.json`, 'utf8')); }
  catch { throw new Error('codedrobe-core local installation is missing'); }
  if (manifest.version !== FIXED_VERSION) throw new Error(`codedrobe-core version must be ${FIXED_VERSION}`);
  return Object.freeze({ root: coreRoot, version: manifest.version, network: 'disabled' });
}
