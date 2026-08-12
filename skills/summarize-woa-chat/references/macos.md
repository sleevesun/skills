# macOS 适配

## 读取链路

1. 从 `~/Library/Application Support/WOA/browser.history.<uid>.json` 发现账号和会话索引。
2. 先发现 `127.0.0.1:9229` 或 `127.0.0.1:9230` 上已存在的 WOA Node Inspector；未发现时对已运行的 WOA 主进程发送 `SIGUSR1`。
3. 如 WOA 未运行，使用 `open -a WOA --args --inspect=9229` 启动，但不重启已运行的 WOA。
4. 先校验 Inspector 中的 `process.execPath` 属于 `WOA.app`，再执行读取表达式。
5. 在 WOA Electron 主进程中调用 `safeStorage.decryptString`，密钥不返回 Codex 进程。
6. 使用 WOA 自带的 `@ksxz/better-sqlite3-multiple-ciphers` 只读查询指定 `chat_id + 时间窗`。
7. 如 Inspector 由本次命令打开，在完成后关闭。

## 前置条件

- WOA 已安装且当前 macOS 用户已登录过。
- WOA 本地数据目录和 `browser.history.*.json` 可读。
- 回环地址的 Inspector 端口未被其他 Node 进程占用。

## 故障定位

- `INSPECTOR_UNAVAILABLE`：确认 WOA 已启动，以及 `127.0.0.1:9229` 没有被其他程序占用。可使用 `--inspector-url` 指定一个已为 WOA 打开的 Inspector。
- `KEY_FILE_NOT_FOUND`：通常表示 UID 与当前账号不匹配，或 WOA 本地数据未完成初始化。
- `DATABASE_DECRYPT_FAILED`：记录 WOA 版本和错误代码，不打印密钥；可能是密钥格式或 SQLCipher 参数在新版本中变化。
- `UNSUPPORTED_SCHEMA`：保留错误返回的字段列表，针对新 WOA 版本更新查询适配器。

不要为解决 Inspector 问题强制终止或重启用户已运行的 WOA。
