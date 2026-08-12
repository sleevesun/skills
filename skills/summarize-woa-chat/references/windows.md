# Windows 适配

## 读取链路

1. 从 `%APPDATA%\WOA\browser.history.<uid>.json` 发现账号和会话索引。
2. 读取 `%APPDATA%\WOA\Local State` 中的 `os_crypt.encrypted_key`。
3. 去掉 `DPAPI` 前缀，通过当前 Windows 用户的 `ProtectedData.Unprotect` 得到 32 字节 master key。
4. 使用 AES-256-GCM 解密 `kim\<sha1(uid+":messages")[0:32]>` 密钥文件。
5. 复制 `ksxz-messages.sqlite` 及存在的 `-wal`/`-shm` 到随机临时目录。
6. 对快照设置 `cipher=sqlcipher` 和 `legacy=4`，执行 `quick_check` 后分页查询目标会话。
7. 关闭数据库并删除本次临时快照。

整个过程不启动、重启或注入 WOA。DPAPI master key 和 SQLCipher 密钥只在内存中存在，不写入临时文件、日志或 manifest。

## 首次安装

Windows 直读依赖 `better-sqlite3-multiple-ciphers@12.10.0`。运行：

```powershell
node scripts/bootstrap.mjs
node scripts/woa-chat.mjs doctor
```

bootstrap 不依赖 npm，它会：

- 固定 npm 包版本，并校验 registry 提供的 integrity。
- 按 `process.platform + process.arch + Node ABI` 选择官方预构建。
- 校验预构建的固定 SHA-256。
- 只安装到当前 Skill 的 `node_modules`，不修改全局 Node 或 npm。

支持 Node.js 22/24/26 的 x64/arm64 Windows 预构建。如系统 Node 版本不匹配，优先改用 Codex bundled Node runtime 执行 bootstrap 和后续命令。

## 故障定位

- `DEPENDENCY_MISSING`：运行 bootstrap；不要安装全局 native 包。
- `UNSUPPORTED_RUNTIME`：改用 Node.js 22、24 或 26；同一个 native 模块不能在不同 Node ABI 间混用。
- `DPAPI_FAILED`：必须使用 WOA 数据所属的同一 Windows 用户运行。从另一设备或另一用户复制的加密文件无法解密。
- `KEY_DECRYPT_FAILED`：检查 UID 和密钥文件是否属于同一账号。
- `DATABASE_READ_FAILED`：命令会自动重试临时快照；持续失败时记录 WOA 版本和错误代码。
- `UNSUPPORTED_SCHEMA`：WOA 升级可能修改 `messages` 表，需要根据返回的字段列表更新适配器。

新设备仅能读取 WOA 已同步到该设备的历史。这不是旧设备密钥或本地数据库的迁移工具。
