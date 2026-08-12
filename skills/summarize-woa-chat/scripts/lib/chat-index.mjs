import fs from "node:fs";
import path from "node:path";
import { WoaChatError } from "./errors.mjs";

const HISTORY_RE = /^browser\.history\.(.+)\.json$/;

export function discoverAccounts(woaRoot) {
  if (!fs.existsSync(woaRoot)) {
    throw new WoaChatError("WOA_ROOT_NOT_FOUND", "未找到 WOA 用户数据目录。");
  }
  const accounts = [];
  for (const name of fs.readdirSync(woaRoot).sort()) {
    const match = name.match(HISTORY_RE);
    if (!match) continue;
    const filePath = path.join(woaRoot, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      accounts.push({
        uid: String(match[1]),
        chats: dedupeChats(collectChats(parsed)),
        source: filePath
      });
    } catch {
      accounts.push({ uid: String(match[1]), chats: [], source: filePath, unreadable: true });
    }
  }
  return mergeAccounts(accounts);
}

export function resolveChat(accounts, options = {}) {
  let eligible = accounts || [];
  if (options.uid) {
    eligible = eligible.filter((account) => account.uid === String(options.uid));
    if (!eligible.length) {
      throw new WoaChatError("ACCOUNT_NOT_FOUND", `未发现 WOA 账号 UID ${options.uid}。`, {
        accounts: (accounts || []).map((account) => account.uid)
      });
    }
  }
  if (!eligible.length) {
    throw new WoaChatError("ACCOUNT_NOT_FOUND", "未从 browser.history.*.json 发现 WOA 账号。");
  }

  if (options.chatId) {
    const chatId = String(options.chatId);
    const indexed = flatten(eligible).filter((item) => item.id === chatId);
    const unique = dedupeCandidates(indexed);
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) return disambiguate(unique);
    if (eligible.length === 1) {
      return { uid: eligible[0].uid, id: chatId, name: chatId, type: "unknown" };
    }
    throw new WoaChatError("AMBIGUOUS_ACCOUNT", "该 chat_id 未出现在本地索引中，多账号环境下需要 --uid。", {
      accounts: eligible.map((account) => account.uid),
      chat_id: chatId
    });
  }

  const query = normalizeName(options.chat || "");
  if (!query) {
    throw new WoaChatError("CHAT_REQUIRED", "必须通过 --chat 或 --chat-id 指定目标会话。");
  }
  const all = flatten(eligible);
  const exact = dedupeCandidates(all.filter((item) => normalizeName(item.name) === query));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return disambiguate(exact);
  const partial = dedupeCandidates(all.filter((item) => normalizeName(item.name).includes(query)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) return disambiguate(partial);
  throw new WoaChatError("CHAT_NOT_FOUND", `未找到会话：${options.chat}`, {
    suggestions: suggest(all, query)
  });
}

export function searchChats(accounts, query = "") {
  const normalized = normalizeName(query);
  const candidates = flatten(accounts || []);
  const filtered = normalized
    ? candidates.filter((item) => normalizeName(item.name).includes(normalized) || item.id.includes(String(query)))
    : candidates;
  return dedupeCandidates(filtered).sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN") || left.uid.localeCompare(right.uid) || left.id.localeCompare(right.id)
  );
}

function collectChats(value, out = [], depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || depth > 12 || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectChats(item, out, depth + 1, seen);
    return out;
  }
  const id = value.id ?? value.chatId ?? value.chatid ?? value.conversationId;
  const name = value.name ?? value.chatName ?? value.title ?? value.displayName;
  const hasChatSignal = value.chatType !== undefined || value.isGroupChat !== undefined ||
    value.conversationType !== undefined;
  if (id !== undefined && name !== undefined && hasChatSignal) {
    out.push({
      id: String(id),
      name: String(name).trim(),
      type: inferChatType(value)
    });
  }
  for (const child of Object.values(value)) collectChats(child, out, depth + 1, seen);
  return out;
}

function inferChatType(value) {
  if (value.isGroupChat === true) return "group";
  if (value.isGroupChat === false) return "single";
  const raw = String(value.chatType ?? value.conversationType ?? "").toLowerCase();
  if (/group|群/.test(raw)) return "group";
  if (/single|direct|private|单聊|私聊/.test(raw)) return "single";
  return raw || "unknown";
}

function flatten(accounts) {
  return accounts.flatMap((account) => (account.chats || []).map((chat) => ({
    uid: account.uid,
    id: chat.id,
    name: chat.name,
    type: chat.type || "unknown"
  })));
}

function dedupeChats(chats) {
  const seen = new Set();
  return chats.filter((chat) => {
    const key = `${chat.id}\u0000${chat.name}`;
    if (!chat.id || !chat.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeAccounts(accounts) {
  const map = new Map();
  for (const account of accounts) {
    const current = map.get(account.uid) || { uid: account.uid, chats: [], sources: [], unreadable: false };
    current.chats.push(...account.chats);
    current.sources.push(account.source);
    current.unreadable ||= Boolean(account.unreadable);
    map.set(account.uid, current);
  }
  return [...map.values()].map((account) => ({
    ...account,
    chats: dedupeChats(account.chats)
  })).sort((left, right) => left.uid.localeCompare(right.uid));
}

function dedupeCandidates(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.uid}\u0000${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeName(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

function disambiguate(candidates) {
  throw new WoaChatError("AMBIGUOUS_CHAT", "匹配到多个 WOA 会话，需要用户选择 chat_id 和账号 UID。", {
    candidates
  });
}

function suggest(items, query) {
  return items.filter((item) => {
    const name = normalizeName(item.name);
    return [...query].some((char) => name.includes(char));
  }).slice(0, 10);
}
