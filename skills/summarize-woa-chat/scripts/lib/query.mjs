import { WoaChatError } from "./errors.mjs";

const REQUIRED_COLUMNS = ["id", "from", "to", "ctime", "content"];
const OPTIONAL_COLUMNS = [
  "type", "cid", "seq", "pos", "status", "mentions", "is_mention_all", "extra",
  "refer", "refer_id", "is_visible", "is_read", "notices", "senderIdentity"
];

export function inspectMessageSchema(db) {
  const columns = db.prepare("PRAGMA table_info(messages)").all().map((row) => String(row.name));
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length) {
    throw new WoaChatError("UNSUPPORTED_SCHEMA", `WOA messages 表缺少必需字段：${missing.join(", ")}。`, {
      columns
    });
  }
  return columns;
}

export function readTargetMessages(db, options) {
  const columns = inspectMessageSchema(db);
  const pageSize = Number(options.pageSize || 2000);
  const maxMessages = Number(options.maxMessages || 100000);
  const peer = peerExpression();
  const where = `ctime >= ? AND ctime < ? AND ${peer} = ?`;
  const commonParams = [options.startMs, options.endMs, String(options.uid), String(options.chatId)];
  const total = Number(db.prepare(`SELECT count(*) AS count FROM messages WHERE ${where}`).get(...commonParams).count);
  if (total > maxMessages) {
    throw new WoaChatError("MESSAGE_LIMIT_EXCEEDED", `目标时间窗包含 ${total} 条消息，超过安全上限 ${maxMessages}。`, {
      total,
      max_messages: maxMessages
    });
  }
  const select = selectColumns(columns);
  const statement = db.prepare(
    `SELECT ${select} FROM messages WHERE ${where} ORDER BY ctime ASC, id ASC LIMIT ? OFFSET ?`
  );
  const rows = [];
  for (let offset = 0; offset < total; offset += pageSize) {
    rows.push(...statement.all(...commonParams, pageSize, offset));
  }
  return { rows, total, columns };
}

export function peerExpression() {
  return "CASE WHEN CAST(\"to\" AS TEXT) = CAST(? AS TEXT) THEN CAST(\"from\" AS TEXT) ELSE CAST(\"to\" AS TEXT) END";
}

export function selectColumns(columns) {
  const available = new Set(columns);
  const selected = [
    '"id" AS id',
    '"from" AS from_uid',
    '"to" AS to_uid',
    '"ctime" AS ctime',
    '"content" AS content'
  ];
  for (const name of OPTIONAL_COLUMNS) {
    if (!available.has(name)) continue;
    selected.push(`"${name}" AS "${name}"`);
  }
  return selected.join(", ");
}
