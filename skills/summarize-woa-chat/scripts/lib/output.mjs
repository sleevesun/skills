import fs from "node:fs";
import path from "node:path";

export function writeFetchResult(options) {
  const targetDir = path.join(
    options.cacheRoot,
    safePart(options.target.uid),
    safePart(options.target.id),
    safePart(options.window.label)
  );
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const recordsPath = path.join(targetDir, "records.jsonl");
  const markdownPath = path.join(targetDir, "records.md");
  const manifestPath = path.join(targetDir, "manifest.json");
  const manifest = {
    status: "done",
    source: "WOA local database",
    platform: options.platform,
    account_uid: options.target.uid,
    chat_id: options.target.id,
    chat_name: options.target.name,
    chat_type: options.target.type,
    window: {
      timezone: options.window.timezone,
      start: options.window.startIso,
      end: options.window.endIso,
      start_local: options.window.startLocal,
      end_local: options.window.endLocal
    },
    records: options.records.length,
    coverage: {
      complete: options.records.length === options.total,
      database_count: options.total,
      exported_count: options.records.length
    },
    records_path: recordsPath,
    records_markdown_path: markdownPath,
    generated_at: new Date().toISOString(),
    diagnostics: sanitizeDiagnostics(options.diagnostics || {})
  };
  writeAtomic(recordsPath, options.records.map((record) => JSON.stringify(record)).join("\n") + (options.records.length ? "\n" : ""));
  writeAtomic(markdownPath, renderRecordsMarkdown(options.records, manifest));
  writeAtomic(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { targetDir, recordsPath, markdownPath, manifestPath, manifest };
}

export function renderRecordsMarkdown(records, manifest) {
  const lines = [
    `# ${manifest.chat_name || manifest.chat_id} WOA 聊天记录`,
    "",
    `- chat_id: ${manifest.chat_id}`,
    `- window_start: ${manifest.window.start_local}`,
    `- window_end: ${manifest.window.end_local}`,
    `- records: ${records.length}`,
    ""
  ];
  let date = "";
  for (const record of records) {
    const current = String(record.sent_at || "").slice(0, 10) || "unknown";
    if (current !== date) {
      date = current;
      lines.push(`## ${date}`, "");
    }
    const sender = record.sender_name || record.sender_id || "未知发送人";
    const text = record.text || attachmentSummary(record) || `[消息类型: ${record.message_type}]`;
    lines.push(`- ${record.sent_at || "未知时间"} | ${sender} | ${text.replace(/\s+/g, " ").trim()}`);
  }
  return lines.join("\n") + "\n";
}

function attachmentSummary(record) {
  return (record.attachments || []).map((item) => `[附件: ${item.name || item.type}]`).join(" ");
}

function writeAtomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, { mode: 0o600 });
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (process.platform !== "win32" || !fs.existsSync(filePath)) throw error;
    fs.unlinkSync(filePath);
    fs.renameSync(tempPath, filePath);
  }
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function safePart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

function sanitizeDiagnostics(value) {
  const allowed = ["quick_check", "schema_columns", "pages", "inspector_opened", "snapshot_attempts"];
  return Object.fromEntries(allowed.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}
