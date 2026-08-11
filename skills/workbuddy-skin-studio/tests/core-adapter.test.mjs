import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
test('codedrobe-core is fixed-version local-only and Apache notice is shipped', async () => {
  const source = await readFile(`${root}/runtime/adapters/codedrobe-core.mjs`, 'utf8');
  assert.match(source, /FIXED_VERSION/); assert.match(source, /npx|network|offline/i);
  assert.match(source, /local|install/i); assert.doesNotMatch(source, /exec\s*\(|spawn\s*\(/);
  assert.match(await readFile(`${root}/runtime/NOTICE`, 'utf8'), /Apache License/i);
});
