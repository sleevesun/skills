---
name: summarize-woa-chat
description: "按用户指定的群聊或联系人，在 macOS 或 Windows 上按需读取本机 WOA 聊天记录并生成可追溯的中文总结。用于“总结 WOA 群聊”、“回顾与某联系人的沟通”、“提取近期 WOA 决定、待办或风险”等请求；未指定时间时默认读取最近 15 天。也用于新设备上的 WOA 读取环境检查、平台适配和首次依赖安装。"
---

# Summarize WOA Chat

只读取用户要求的会话和时间窗，将脱敏后的记录保存到用户缓存目录，再基于真实记录生成总结。不创建定时任务，不启动常驻缓存进程。

## 安全边界

- 将用户的总结请求视为对目标会话和目标时间窗的读取授权，不扩展到其他会话。
- 仅使用 WOA 当前登录用户在本机已同步的数据；不绕过密聊、禁止下载、水印、保密或权限限制。
- 不显示、记录或持久化 SQLCipher 密钥、DPAPI master key、Cookie、Token 或签名 URL。
- 不自动发送、发布或上传聊天记录和总结。
- 不把读取失败、索引缺失或未覆盖误报为“没有消息”。

## 执行流程

### 1. 检查新设备

首次使用、更换设备或底层读取失败时，在 Skill 目录运行：

```bash
node scripts/woa-chat.mjs doctor
```

要求 WOA 桌面端已安装且当前系统用户已登录过 WOA。根据 `doctor` 输出处理：

- `ready`：继续解析会话。
- `needs_bootstrap`：在 Windows 上运行 `node scripts/bootstrap.mjs`，然后重试 `doctor`。该命令只在 Skill 目录安装固定版本的 SQLCipher 读取依赖。
- `blocked`：根据输出的错误代码处理，必要时读取 `references/macos.md` 或 `references/windows.md`。

Windows 首次 bootstrap 需要联网，并且仅支持官方预构建覆盖的 Node.js 22/24/26。优先使用 Codex bundled Node runtime；不要为了安装依赖而修改用户的系统 Node 配置。

### 2. 解析时间窗

- 用户未指定时间时，使用滚动的最近 15 天：`--days 15`。
- 用户指定时间时，传入 `--from` 和 `--to`。纯日期的 `--to` 包含当天，内部按次日 00:00 的开区间右边界处理。
- 未带时区的日期时间按 `Asia/Shanghai` 解析；带 `Z` 或偏移量时保留其明确时区。

### 3. 解析会话

先用本地会话索引做只读匹配：

```bash
node scripts/woa-chat.mjs list-chats --query "项目讨论群"
node scripts/woa-chat.mjs fetch --chat "项目讨论群" --days 15 --dry-run
```

- 名称精确且唯一时直接使用。
- 同名会话、多账号或多个模糊匹配时，向用户展示 `candidates`，请其选择；不得静默猜测。
- 用户提供 `chat_id` 时使用 `--chat-id`。多账号环境中必要时同时传入 `--uid`。

### 4. 按需读取

```bash
node scripts/woa-chat.mjs fetch --chat "项目讨论群" --days 15
node scripts/woa-chat.mjs fetch --chat-id 1234567 --uid 10001 \
  --from "2026-08-01" --to "2026-08-12"
```

macOS 适配器在 WOA 进程内使用 Electron `safeStorage` 解密并只读查询；如 WOA 未运行会尝试启动。Windows 适配器使用当前用户 DPAPI 和 AES-GCM 在内存中解密密钥，并对 SQLite/WAL/SHM 临时快照只读查询；不启动或重启 WOA。

命令完成后只使用 stdout JSON 中的 `manifest_path` 和 `records_path`。先检查 manifest：

- `status` 必须为 `done`。
- `coverage.complete` 必须为 `true`。
- `records` 可以为 0，但只有前两项成立时才能判断为该时段无消息。

### 5. 分段总结

记录较多时先生成稳定分块：

```bash
node scripts/prepare-summary.mjs --input "/absolute/path/records.jsonl"
```

逐个读取 `summary-chunks/chunk-*.md`，对每块提取事实、决定、待办、风险和未决问题，再合并去重。不得只根据关键词或少量抽样生成整个时间窗的结论。详细格式和证据规则见 `references/output-schema.md`。

## 失败处理

- `AMBIGUOUS_CHAT`：展示候选会话的名称、`chat_id`、类型和账号 UID，请用户确认。
- `ACCOUNT_NOT_FOUND`：请用户确认 WOA 已登录过，或用 `--uid` 指定索引中已发现的账号。
- `DEPENDENCY_MISSING`：仅在 Windows 执行 bootstrap，不要安装全局 npm 包。
- `MESSAGE_LIMIT_EXCEEDED`：报告实际消息数，请用户缩短时间窗；除非用户明确要求，不得通过无界的 `--max-messages` 规避限制。
- `INSPECTOR_UNAVAILABLE`：读取 `references/macos.md`，报告 WOA 启动或本地 Inspector 失败；不重启或强制终止 WOA。
- `DPAPI_FAILED`：读取 `references/windows.md`，确认 Skill 与 WOA 由同一 Windows 用户运行。

## 参考资料

- 处理 macOS 底层读取或 Inspector 故障时，读取 `references/macos.md`。
- 处理 Windows 安装、DPAPI、快照或 native 模块故障时，读取 `references/windows.md`。
- 总结记录或解释产物字段时，读取 `references/output-schema.md`。
