import { redactSecrets, redactString } from "./security.mjs";

const TYPE_NAMES = new Map([
  [1, "text"],
  [2, "image"],
  [3, "file"],
  [4, "voice"],
  [5, "video"]
]);

export function normalizeRows(rows, context) {
  const seen = new Set();
  const records = [];
  for (const row of rows || []) {
    const record = normalizeRow(row, context);
    const key = record.message_id || `${record.chat_id}:${record.sent_at}:${record.sender_id}:${record.text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(record);
  }
  return records.sort((left, right) =>
    Date.parse(left.sent_at || 0) - Date.parse(right.sent_at || 0) ||
    String(left.message_id).localeCompare(String(right.message_id))
  );
}

export function normalizeRow(row, context = {}) {
  const content = parsePayload(row.content);
  const extra = parsePayload(row.extra);
  const senderIdentity = parsePayload(row.senderIdentity ?? row.sender_identity);
  const senderId = stringValue(row.from_uid ?? row.from ?? row.sender ?? "");
  const text = redactString(extractText(content) || "");
  return {
    chat_id: String(context.chatId || peerId(row, context.uid) || ""),
    chat_name: String(context.chatName || context.chatId || ""),
    chat_type: String(context.chatType || "unknown"),
    message_id: stringValue(row.id ?? row.message_id ?? row.msgid),
    seq: row.seq ?? row.ctime ?? "",
    sender_id: senderId,
    sender_name: senderName(extra, senderIdentity, senderId),
    sent_at: normalizeTime(row.ctime ?? row.sent_at),
    message_type: normalizeType(row.type ?? row.msgType, content),
    text,
    attachments: collectAttachments({ content, extra }),
    status: detectStatus({ row, content, extra })
  };
}

function parsePayload(value) {
  if (value == null || value === "") return {};
  if (Buffer.isBuffer(value)) return parsePayload(value.toString("utf8"));
  if (value && value.type === "Buffer" && Array.isArray(value.data)) {
    return parsePayload(Buffer.from(value.data).toString("utf8"));
  }
  if (typeof value === "object") return redactSecrets(value);
  try {
    return redactSecrets(JSON.parse(String(value)));
  } catch {
    return { raw_text: redactString(String(value)) };
  }
}

function extractText(value, depth = 0, seen = new WeakSet()) {
  if (value == null || depth > 8) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  for (const key of ["text", "plainText", "raw_text", "msgDesc", "title", "content", "name", "fileName"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  if (Array.isArray(value)) {
    return unique(value.map((item) => extractText(item, depth + 1, seen)).filter(Boolean)).join(" ");
  }
  for (const child of Object.values(value)) {
    const text = extractText(child, depth + 1, seen);
    if (text) return text;
  }
  return "";
}

function collectAttachments(root) {
  const attachments = [];
  visit(root, (value, trail) => {
    const name = value && (value.fileName || value.filename || value.name);
    const mime = value && (value.mimeType || value.mime || "");
    const type = value && (value.fileType || value.type || "");
    const trailText = trail.join(".").toLowerCase();
    if (!name || !/(file|image|img|photo|video|audio|attachment|doc|pdf|sheet)/i.test(`${trailText} ${mime} ${type}`)) return;
    attachments.push({
      name: redactString(String(name)),
      type: inferAttachmentType(name, mime, type),
      size: value.size ?? "",
      extracted_text: "",
      status: "metadata_only"
    });
  });
  const seen = new Set();
  return attachments.filter((item) => {
    const key = `${item.name}\u0000${item.type}\u0000${item.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function visit(value, callback, trail = [], depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return;
  seen.add(value);
  callback(value, trail);
  if (Array.isArray(value)) {
    value.slice(0, 200).forEach((item, index) => visit(item, callback, [...trail, String(index)], depth + 1, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visit(child, callback, [...trail, key], depth + 1, seen);
  }
}

function senderName(extra, identity, fallback) {
  for (const value of [identity, extra && extra.sender_profile, extra]) {
    if (!value || typeof value !== "object") continue;
    const name = value.name || value.nickname || value.displayName || value.nickName;
    if (name) return redactString(String(name));
  }
  return fallback;
}

function peerId(row, uid) {
  const from = String(row.from_uid ?? row.from ?? "");
  const to = String(row.to_uid ?? row.to ?? "");
  return to === String(uid || "") ? from : to;
}

function normalizeType(value, content) {
  const number = Number(value);
  if (TYPE_NAMES.has(number)) return TYPE_NAMES.get(number);
  const text = String(value || "").toLowerCase();
  if (text) return text;
  return extractText(content) ? "text" : "unknown";
}

function inferAttachmentType(name, mime, type) {
  const value = `${name} ${mime} ${type}`.toLowerCase();
  if (/image|\.(png|jpe?g|gif|webp|heic)$/.test(value)) return "image";
  if (/pdf|\.pdf$/.test(value)) return "pdf";
  if (/spreadsheet|excel|\.(xlsx?|csv)$/.test(value)) return "spreadsheet";
  if (/word|document|\.(docx?|wps)$/.test(value)) return "document";
  if (/video|\.(mp4|mov|avi)$/.test(value)) return "video";
  if (/audio|voice|\.(mp3|m4a|wav)$/.test(value)) return "audio";
  return "file";
}

function detectStatus(value) {
  const text = JSON.stringify(value).toLowerCase();
  return /(restricted|forbidden|permission|unauthorized|confidential|watermark|禁止|保密|无权限)/.test(text)
    ? "restricted"
    : "ok";
}

function normalizeTime(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Date(number < 10_000_000_000 ? number * 1000 : number).toISOString();
}

function stringValue(value) {
  return value == null ? "" : String(value);
}

function unique(items) {
  return [...new Set(items)];
}
