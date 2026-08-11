import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const studio = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('Skill 与交付手册模板覆盖双平台输入、确认重启、验证和恢复流程', async () => {
  const studioSkill = await readFile(join(studio, 'SKILL.md'), 'utf8');
  const generator = await readFile(join(studio, 'scripts/generate-theme-package.mjs'), 'utf8');
  for (const text of [studioSkill, generator]) {
    assert.match(text, /macOS|macos/i);
    assert.match(text, /Windows|windows/i);
    assert.match(text, /重启并应用/);
    assert.match(text, /验证|verify/i);
    assert.match(text, /恢复|restore/i);
  }
  assert.match(studioSkill, /图片|主题描述/);
  assert.match(studioSkill, /目标平台/);
  assert.match(studioSkill, /重启并应用/);
  assert.match(generator, /图片|素材/);
  assert.match(generator, /目标平台/);
  assert.match(generator, /app\.asar/);
});
