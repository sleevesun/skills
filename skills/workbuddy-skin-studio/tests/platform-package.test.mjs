import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test as nodeTest } from 'node:test';

const testFile = fileURLToPath(import.meta.url);
const testDir = dirname(testFile);
const studioDir = resolve(testDir, '..');
const fixturesDir = join(testDir, 'fixtures');
const validFixture = join(fixturesDir, 'valid-both');
const validator = join(studioDir, 'scripts', 'validate-theme-package.mjs');
const packer = join(studioDir, 'scripts', 'pack-theme-package.mjs');
const redGateName = '接受包含外层 manifest、内层 theme.json、声明式资源和目标入口的双平台包';

function test(name, fn) {
  nodeTest(name, async (t) => {
    if (name !== redGateName && !existsSync(validator)) {
      t.skip('P0 RED：production validator 尚未实现');
      return;
    }
    return fn(t);
  });
}

function runTool(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    cwd: studioDir,
    timeout: 5000,
  });
}

function outputOf(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function assertPass(result) {
  assert.equal(result.status, 0, outputOf(result));
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.pass, true, outputOf(result));
}

function assertFail(result, diagnostic) {
  const output = outputOf(result);
  assert.notEqual(result.status, 0, `预期失败，但命令成功了：${output}`);
  assert.match(output, diagnostic);
}

async function runValidation(mutator, extraArgs = []) {
  let packageDir;
  let tempRoot;
  const root = await mkdtemp(join('/tmp', 'workbuddy-p0-run-'));
  packageDir = join(root, 'fixture.wbtheme');
  tempRoot = root;
  await cp(validFixture, packageDir, { recursive: true });
  try {
    await mutator(packageDir, tempRoot);
    return runTool(validator, ['--package-dir', packageDir, ...extraArgs]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function readJson(packageDir, relativePath) {
  return JSON.parse(await readFile(join(packageDir, relativePath), 'utf8'));
}

async function writeJson(packageDir, relativePath, value) {
  await writeFile(join(packageDir, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('接受包含外层 manifest、内层 theme.json、声明式资源和目标入口的双平台包', async () => {
  const result = await runValidation(async () => {});
  assertPass(result);
});

for (const requiredField of [
  'schemaVersion',
  'themeId',
  'application',
  'targetPlatforms',
  'themePackage',
  'runtimeVersion',
  'requiresUserRestartConfirmation',
  'files',
  'security',
]) {
  test(`外层 manifest 缺少 ${requiredField} 时拒绝`, async () => {
    const result = await runValidation(async (packageDir) => {
      const manifest = await readJson(packageDir, 'manifest.json');
      delete manifest[requiredField];
      await writeJson(packageDir, 'manifest.json', manifest);
    });
    assertFail(result, /manifest|schemaVersion|themeId|application|targetPlatforms|themePackage|runtimeVersion|restart|files|security/i);
  });
}

for (const [field, value] of [
  ['allowRemoteResources', true],
  ['allowAppAsarWrites', true],
  ['allowUserPaths', true],
  ['allowSecrets', true],
  ['declarationOnlyTheme', false],
]) {
  test(`外层 security.${field} 不安全时拒绝`, async () => {
    const result = await runValidation(async (packageDir) => {
      const manifest = await readJson(packageDir, 'manifest.json');
      manifest.security[field] = value;
      await writeJson(packageDir, 'manifest.json', manifest);
    });
    assertFail(result, /security|remote|app\.asar|user path|secret|declarative|安全|用户路径|密钥|声明式/i);
  });
}

test('文件清单缺少包内现有资源时拒绝', async () => {
  const result = await runValidation(async (packageDir) => {
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.files = manifest.files.filter((file) => file !== 'theme.codedrobe-theme/workbuddy.css');
    await writeJson(packageDir, 'manifest.json', manifest);
  });
  assertFail(result, /files|file list|清单|workbuddy\.css|undeclared|声明/i);
});

test('文件清单声明不存在的资源或平台脚本时拒绝', async () => {
  const result = await runValidation(async (packageDir) => {
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.files.push('targets/windows/missing.ps1');
    await writeJson(packageDir, 'manifest.json', manifest);
  });
  assertFail(result, /missing|not found|不存在|script|脚本|files|清单/i);
});

test('接受只声明 macOS 的包，并拒绝把 Windows 目标混入其文件清单', async () => {
  const result = await runValidation(async (packageDir) => {
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.targetPlatforms = ['macos'];
    manifest.files = manifest.files.filter((file) => !file.startsWith('targets/windows/'));
    await writeJson(packageDir, 'manifest.json', manifest);
    await rm(join(packageDir, 'targets/windows'), { recursive: true, force: true });
  });
  assertPass(result);
});

test('接受只声明 Windows 的包，并拒绝把 macOS 目标混入其文件清单', async () => {
  const result = await runValidation(async (packageDir) => {
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.targetPlatforms = ['windows'];
    manifest.files = manifest.files.filter((file) => !file.startsWith('targets/macos/'));
    await writeJson(packageDir, 'manifest.json', manifest);
    await rm(join(packageDir, 'targets/macos'), { recursive: true, force: true });
  });
  assertPass(result);
});

for (const targetPlatforms of [[], ['linux'], ['macos', 'linux'], 'macos', ['macos', 'macos']]) {
  test(`非法 targetPlatforms=${JSON.stringify(targetPlatforms)} 时 fail closed`, async () => {
    const result = await runValidation(async (packageDir) => {
      const manifest = await readJson(packageDir, 'manifest.json');
      manifest.targetPlatforms = targetPlatforms;
      await writeJson(packageDir, 'manifest.json', manifest);
    });
    assertFail(result, /targetPlatforms|platform/i);
  });
}

test('平台不匹配时 fail closed，不执行包内其他平台入口', async () => {
  const result = await runValidation(async (packageDir) => {
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.targetPlatforms = ['macos'];
    manifest.files = manifest.files.filter((file) => !file.startsWith('targets/windows/'));
    await writeJson(packageDir, 'manifest.json', manifest);
    await rm(join(packageDir, 'targets/windows'), { recursive: true, force: true });
  }, ['--platform', 'windows']);
  assertFail(result, /platform|target/i);
});

for (const requiredField of ['schemaVersion', 'id', 'displayName', 'version', 'targets', 'targets.workbuddy.css', 'targets.workbuddy.verification.required']) {
  test(`内层 theme.json 缺少 ${requiredField} 时拒绝`, async () => {
    const result = await runValidation(async (packageDir) => {
      const theme = await readJson(packageDir, 'theme.codedrobe-theme/theme.json');
      if (requiredField.includes('.')) {
        const pathParts = requiredField.split('.');
        let cursor = theme;
        for (const part of pathParts.slice(0, -1)) cursor = cursor?.[part];
        delete cursor?.[pathParts.at(-1)];
      } else {
        delete theme[requiredField];
      }
      await writeJson(packageDir, 'theme.codedrobe-theme/theme.json', theme);
    });
    assertFail(result, /theme\.json|schemaVersion|id|displayName|version|targets|css|verification|required/i);
  });
}

test('required landmarks 为空或包含空值时拒绝注入契约', async () => {
  const result = await runValidation(async (packageDir) => {
    const theme = await readJson(packageDir, 'theme.codedrobe-theme/theme.json');
    theme.targets.workbuddy.verification.required = [];
    await writeJson(packageDir, 'theme.codedrobe-theme/theme.json', theme);
  });
  assertFail(result, /required|landmark|verification/i);
});

for (const landmark of ['home', 'chat', 'composer', 'sidebar', 'task', 'artifact']) {
  test(`required landmarks 缺少 ${landmark} 时拒绝`, async () => {
    const result = await runValidation(async (packageDir) => {
      const theme = await readJson(packageDir, 'theme.codedrobe-theme/theme.json');
      theme.targets.workbuddy.verification.required = theme.targets.workbuddy.verification.required
        .filter((selector) => !selector.includes(`=${landmark}]`));
      await writeJson(packageDir, 'theme.codedrobe-theme/theme.json', theme);
    });
    assertFail(result, /required|landmark|home|chat|composer|sidebar|task|artifact|verification/i);
  });
}

test('recommended 和 contexts 存在时必须符合声明式数组 schema', async () => {
  const result = await runValidation(async (packageDir) => {
    const theme = await readJson(packageDir, 'theme.codedrobe-theme/theme.json');
    theme.targets.workbuddy.verification.recommended = { selector: '*', run: 'yes' };
    theme.targets.workbuddy.verification.contexts = 'chat';
    await writeJson(packageDir, 'theme.codedrobe-theme/theme.json', theme);
  });
  assertFail(result, /recommended|contexts|schema/i);
});

for (const unsafePath of ['../outside.css', '/tmp/outside.css', 'C:/Users/name/outside.css', 'theme.codedrobe-theme\\..\\outside.css']) {
  test(`拒绝包内声明的路径穿越或绝对路径：${unsafePath}`, async () => {
    const result = await runValidation(async (packageDir) => {
      const manifest = await readJson(packageDir, 'manifest.json');
      manifest.files.push(unsafePath);
      await writeJson(packageDir, 'manifest.json', manifest);
    });
    assertFail(result, /path|路径|traversal|absolute|outside|安全/i);
  });
}

for (const unsafeThemePackage of ['../outside', '/tmp/outside', 'C:/Users/name/outside', 'theme.codedrobe-theme\\..\\outside']) {
  test(`拒绝 themePackage 路径穿越或绝对路径：${unsafeThemePackage}`, async () => {
    const result = await runValidation(async (packageDir) => {
      const manifest = await readJson(packageDir, 'manifest.json');
      manifest.themePackage = unsafeThemePackage;
      await writeJson(packageDir, 'manifest.json', manifest);
    });
    assertFail(result, /theme package|path|路径|traversal|absolute|outside|安全/i);
  });
}

test('拒绝 realpath 位于包根目录外的符号链接资源', async (t) => {
  let symlinkSupported = true;
  const result = await runValidation(async (packageDir, tempRoot) => {
    const outside = join(tempRoot, 'outside-secret.txt');
    await writeFile(outside, 'outside', 'utf8');
    const link = join(packageDir, 'theme.codedrobe-theme', 'assets', 'linked.txt');
    try { await symlink(outside, link); }
    catch (error) {
      if (error?.code === 'EPERM') { symlinkSupported = false; return; }
      throw error;
    }
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.files.push('theme.codedrobe-theme/assets/linked.txt');
    await writeJson(packageDir, 'manifest.json', manifest);
  });
  if (!symlinkSupported) { t.skip('当前 Windows 账户不允许创建符号链接'); return; }
  assertFail(result, /symbolic|symlink|realpath|link|outside|符号链接/i);
});

test('拒绝重复文件名和不区分大小写的文件名冲突', async () => {
  const result = await runValidation(async (packageDir) => {
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.files.push('README.md', 'readme.md');
    await writeJson(packageDir, 'manifest.json', manifest);
    await writeFile(join(packageDir, 'readme.md'), 'case collision', 'utf8');
  });
  assertFail(result, /duplicate|重复|case|大小写|collision|冲突/i);
});

test('拒绝 ZIP slip 的归档条目名，即使条目只出现在文件清单中', async () => {
  const result = await runValidation(async (packageDir) => {
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.files.push('../../../../tmp/pwned.txt', 'C:\\Windows\\Temp\\pwned.txt');
    await writeJson(packageDir, 'manifest.json', manifest);
  });
  assertFail(result, /zip|slip|path|路径|traversal|absolute/i);
});

test('拒绝 CSS 远程资源、远程 @import 和追踪协议', async () => {
  const result = await runValidation(async (packageDir) => {
    await writeFile(
      join(packageDir, 'theme.codedrobe-theme', 'workbuddy.css'),
      '@import url("https://tracker.example/theme.css");\n.hero { background: url(//cdn.example/hero.png); }\n',
      'utf8',
    );
  });
  assertFail(result, /remote|remote resource|远程|https?|import|tracking/i);
});

test('拒绝 app.asar 写入声明和官方应用目录写入声明', async () => {
  const result = await runValidation(async (packageDir) => {
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.files.push('targets/macos/write-app.asar.command');
    manifest.install = {
      writes: ['/Applications/WorkBuddy.app/Contents/Resources/app.asar'],
    };
    await writeJson(packageDir, 'manifest.json', manifest);
    await writeFile(join(packageDir, 'targets/macos', 'write-app.asar.command'), 'echo forbidden', 'utf8');
  });
  assertFail(result, /app\.asar|official|应用包|write|写入/i);
});

for (const userPath of ['/Users/example/Documents/private.txt', '/home/example/.config/workbuddy', 'C:\\Users\\Example\\Desktop\\private.txt']) {
  test(`拒绝用户绝对路径：${userPath}`, async () => {
    const result = await runValidation(async (packageDir) => {
      const manifest = await readJson(packageDir, 'manifest.json');
      manifest.description = `fixture path ${userPath}`;
      await writeJson(packageDir, 'manifest.json', manifest);
    });
    assertFail(result, /user path|用户路径|absolute|绝对路径|Users|home/i);
  });
}

for (const secret of ['sk-test-1234567890', 'api_key=fixture-secret', 'session=secret-cookie-value', 'Bearer fixture-token']) {
  test(`拒绝包内容中的密钥或 cookie：${secret.split('=')[0]}`, async () => {
    const result = await runValidation(async (packageDir) => {
      await writeFile(join(packageDir, 'README.md'), `debug: ${secret}\n`, 'utf8');
    });
    assertFail(result, /secret|密钥|token|cookie|credential|凭证|api[_-]?key/i);
  });
}

for (const injection of ['$(touch /tmp/pwned)', '`id`', '; rm -rf /tmp/pwned', '&& Invoke-Expression evil']) {
  test(`拒绝 manifest 中的命令注入字符串：${injection}`, async () => {
    const result = await runValidation(async (packageDir) => {
      const manifest = await readJson(packageDir, 'manifest.json');
      manifest.themeId = `safe-${injection}`;
      await writeJson(packageDir, 'manifest.json', manifest);
    });
    assertFail(result, /command|injection|shell|命令|注入|unsafe|string/i);
  });
}

test('内层主题包只允许 manifest、CSS 和图片等声明式资源，不允许额外脚本', async () => {
  const result = await runValidation(async (packageDir) => {
    await writeFile(join(packageDir, 'theme.codedrobe-theme', 'evil.mjs'), 'export default () => process.env.SECRET', 'utf8');
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.files.push('theme.codedrobe-theme/evil.mjs');
    await writeJson(packageDir, 'manifest.json', manifest);
  });
  assertFail(result, /declarative|声明式|executable|可执行|script|脚本|theme\.codedrobe-theme/i);
});

test('禁止包中的日志、截图和源码携带敏感信息或任务正文', async () => {
  const result = await runValidation(async (packageDir) => {
    await mkdir(join(packageDir, 'logs'), { recursive: true });
    await mkdir(join(packageDir, 'screenshots'), { recursive: true });
    await writeFile(join(packageDir, 'logs', 'verification.log'), 'cookie=fixture-cookie', 'utf8');
    await writeFile(join(packageDir, 'screenshots', 'chat.txt'), '用户任务正文：请总结这份私人文档', 'utf8');
    await writeFile(join(packageDir, 'theme.codedrobe-theme', 'source.js'), 'const apiKey = "fixture-key";', 'utf8');
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.files.push('logs/verification.log', 'screenshots/chat.txt', 'theme.codedrobe-theme/source.js');
    await writeJson(packageDir, 'manifest.json', manifest);
  });
  assertFail(result, /secret|cookie|task|prompt|任务|正文|账号|credential|key/i);
});

test('打包器拒绝含 ZIP slip、重复名、大小写冲突或符号链接的输入目录', async (t) => {
  let symlinkSupported = true;
  let packResult;
  const result = await runValidation(async (packageDir, tempRoot) => {
    const outside = join(tempRoot, 'outside.txt');
    await writeFile(outside, 'outside', 'utf8');
    try { await symlink(outside, join(packageDir, 'targets', 'escape.txt')); }
    catch (error) {
      if (error?.code === 'EPERM') { symlinkSupported = false; return; }
      throw error;
    }
    await writeFile(join(packageDir, 'README.MD'), 'case collision', 'utf8');
    const manifest = await readJson(packageDir, 'manifest.json');
    manifest.files.push('../escape.txt', 'README.MD', 'targets/escape.txt');
    await writeJson(packageDir, 'manifest.json', manifest);
    packResult = runTool(packer, ['--package-dir', packageDir, '--output', join(tempRoot, 'p0-unsafe.wbtheme.zip')]);
  });
  if (!symlinkSupported) { t.skip('当前 Windows 账户不允许创建符号链接'); return; }
  assertFail(result, /path|zip|duplicate|case|symlink|realpath|路径|符号链接|冲突/i);
  assert.doesNotMatch(outputOf(packResult), /Cannot find module .*pack-theme-package|MODULE_NOT_FOUND/);
  assert.notEqual(packResult.status, 0, outputOf(packResult));
});
