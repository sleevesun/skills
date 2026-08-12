#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { parseArgs, positiveInteger } from "./lib/args.mjs";
import { discoverAccounts, resolveChat, searchChats } from "./lib/chat-index.mjs";
import { WoaChatError, errorPayload } from "./lib/errors.mjs";
import { inspectMacAccount, readMacMessages } from "./lib/macos.mjs";
import { normalizeRows } from "./lib/normalize.mjs";
import { writeFetchResult } from "./lib/output.mjs";
import { resolveCacheRoot, resolveWoaRoot, runtimeDescriptor, supportedPlatform } from "./lib/platform.mjs";
import { resolveTimeWindow } from "./lib/time-window.mjs";
import { inspectWindowsAccount, readWindowsMessages, windowsDependencyStatus } from "./lib/windows.mjs";

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = String(args._[0] || "help");
  if (command === "help" || args.help) return { text: usage() };
  if (!supportedPlatform()) {
    throw new WoaChatError("UNSUPPORTED_PLATFORM", `仅支持 macOS 和 Windows，当前平台为 ${process.platform}。`);
  }
  if (command === "doctor") return doctor(args);
  if (command === "list-chats") return listChats(args);
  if (command === "fetch") return fetchChat(args);
  throw new WoaChatError("UNKNOWN_COMMAND", `未知命令：${command}`);
}

export function doctor(args = {}) {
  const runtime = runtimeDescriptor();
  try {
    const woaRoot = resolveWoaRoot({ woaRoot: args.woaRoot });
    const accounts = discoverAccounts(woaRoot);
    const checks = accounts.map((account) => process.platform === "win32"
      ? inspectWindowsAccount(woaRoot, account.uid)
      : inspectMacAccount(woaRoot, account.uid));
    const unreadable = accounts.filter((account) => account.unreadable).map((account) => account.uid);
    const incomplete = checks.filter((check) => Object.entries(check).some(([key, value]) => key !== "uid" && key !== "woa_running" && value === false));
    if (!accounts.length || unreadable.length || incomplete.length) {
      return {
        status: "blocked",
        code: "WOA_DATA_INCOMPLETE",
        runtime,
        accounts: accounts.map(accountSummary),
        checks,
        unreadable_accounts: unreadable
      };
    }
    if (process.platform === "win32" && !windowsDependencyStatus().available) {
      return {
        status: "needs_bootstrap",
        code: "DEPENDENCY_MISSING",
        runtime,
        accounts: accounts.map(accountSummary),
        checks,
        action: "运行 node scripts/bootstrap.mjs，然后重试 doctor。"
      };
    }
    return {
      status: "ready",
      runtime,
      accounts: accounts.map(accountSummary),
      checks,
      note: process.platform === "darwin"
        ? "首次 fetch 会按需打开 WOA 本地 Node Inspector，完成后关闭。"
        : "fetch 将通过 DPAPI 和本地数据库快照只读访问。"
    };
  } catch (error) {
    return {
      status: "blocked",
      code: error.code || "DOCTOR_FAILED",
      message: error.message,
      runtime
    };
  }
}

export function listChats(args = {}) {
  const woaRoot = resolveWoaRoot({ woaRoot: args.woaRoot });
  const accounts = discoverAccounts(woaRoot).filter((account) => !args.uid || account.uid === String(args.uid));
  if (args.uid && !accounts.length) {
    throw new WoaChatError("ACCOUNT_NOT_FOUND", `未发现 WOA 账号 UID ${args.uid}。`);
  }
  const limit = positiveInteger(args.limit, 200, "--limit");
  const chats = searchChats(accounts, args.query || "").slice(0, limit);
  return { status: "done", query: String(args.query || ""), count: chats.length, chats };
}

export async function fetchChat(args = {}) {
  const woaRoot = resolveWoaRoot({ woaRoot: args.woaRoot });
  const accounts = discoverAccounts(woaRoot);
  const target = resolveChat(accounts, {
    uid: args.uid,
    chat: args.chat,
    chatId: args.chatId
  });
  const window = resolveTimeWindow({ from: args.from, to: args.to, days: args.days ?? 15, now: args.now });
  if (args.dryRun) {
    return {
      status: "dry_run",
      platform: process.platform,
      target,
      window: publicWindow(window)
    };
  }
  const pageSize = positiveInteger(args.pageSize, 2000, "--page-size");
  const maxMessages = positiveInteger(args.maxMessages, 100000, "--max-messages");
  const readerOptions = {
    woaRoot,
    uid: target.uid,
    chatId: target.id,
    startMs: window.start.getTime(),
    endMs: window.end.getTime(),
    pageSize,
    maxMessages,
    inspectorUrl: args.inspectorUrl,
    launchTimeoutMs: args.launchTimeout ? Number(args.launchTimeout) * 1000 : undefined
  };
  const result = process.platform === "win32"
    ? readWindowsMessages(readerOptions)
    : await readMacMessages(readerOptions);
  const records = normalizeRows(result.rows, {
    uid: target.uid,
    chatId: target.id,
    chatName: target.name,
    chatType: target.type
  });
  const output = writeFetchResult({
    cacheRoot: resolveCacheRoot({ cacheRoot: args.cacheRoot }),
    target,
    window,
    platform: process.platform,
    records,
    total: result.total,
    diagnostics: result.diagnostics
  });
  return {
    status: output.manifest.status,
    platform: process.platform,
    chat: target,
    window: publicWindow(window),
    records: records.length,
    coverage: output.manifest.coverage,
    manifest_path: output.manifestPath,
    records_path: output.recordsPath,
    records_markdown_path: output.markdownPath
  };
}

function accountSummary(account) {
  return { uid: account.uid, chats: account.chats.length, unreadable_index: Boolean(account.unreadable) };
}

function publicWindow(window) {
  return {
    timezone: window.timezone,
    start: window.startIso,
    end: window.endIso,
    start_local: window.startLocal,
    end_local: window.endLocal
  };
}

function usage() {
  return `Usage:
  node scripts/woa-chat.mjs doctor [--woa-root PATH]
  node scripts/woa-chat.mjs list-chats [--query NAME] [--uid UID] [--limit 200]
  node scripts/woa-chat.mjs fetch (--chat NAME | --chat-id ID) [--uid UID] [--days 15]
  node scripts/woa-chat.mjs fetch --chat NAME --from YYYY-MM-DD --to YYYY-MM-DD

Options:
  --dry-run              只解析会话和时间窗，不读取数据库
  --cache-root PATH      覆盖用户缓存目录
  --page-size 2000       分页条数
  --max-messages 100000  单次安全上限，超过时拒绝截断
  --inspector-url URL    macOS WOA Node Inspector，默认 http://127.0.0.1:9229
`;
}

async function main() {
  try {
    const result = await run();
    if (result && result.text) process.stdout.write(result.text);
    else console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify(errorPayload(error), null, 2));
    process.exitCode = error && error.code === "AMBIGUOUS_CHAT" ? 2 : 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
