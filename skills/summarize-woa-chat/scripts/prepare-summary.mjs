#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, positiveInteger } from "./lib/args.mjs";
import { WoaChatError, errorPayload } from "./lib/errors.mjs";

export function prepareSummary(options) {
  const input = path.resolve(String(options.input || ""));
  if (!options.input || !fs.existsSync(input)) {
    throw new WoaChatError("INPUT_NOT_FOUND", "--input 指定的 records.jsonl 不存在。");
  }
  const records = readJsonl(input);
  const maxChars = positiveInteger(options.maxChars, 48000, "--max-chars");
  const outputDir = path.resolve(String(options.output || path.join(path.dirname(input), "summary-chunks")));
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  for (const name of fs.readdirSync(outputDir)) {
    if (/^chunk-\d{3}\.md$/.test(name) || name === "index.json") fs.unlinkSync(path.join(outputDir, name));
  }
  const chunks = makeChunks(records, maxChars);
  const index = [];
  chunks.forEach((chunk, position) => {
    const name = `chunk-${String(position + 1).padStart(3, "0")}.md`;
    const filePath = path.join(outputDir, name);
    const content = renderChunk(chunk, position + 1, chunks.length);
    fs.writeFileSync(filePath, content, { mode: 0o600 });
    index.push({
      file: filePath,
      records: chunk.length,
      start: chunk[0] ? chunk[0].sent_at : "",
      end: chunk.at(-1) ? chunk.at(-1).sent_at : ""
    });
  });
  const indexPath = path.join(outputDir, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify({ input, records: records.length, chunks: index }, null, 2) + "\n", { mode: 0o600 });
  return { status: "done", input, records: records.length, chunks: chunks.length, output_dir: outputDir, index_path: indexPath };
}

export function makeChunks(records, maxChars = 48000) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const record of records) {
    const rendered = renderRecord(record);
    if (current.length && size + rendered.length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(record);
    size += rendered.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function renderChunk(records, position, total) {
  const lines = [
    `# WOA 总结分块 ${position}/${total}`,
    "",
    `- records: ${records.length}`,
    `- start: ${records[0] ? records[0].sent_at : ""}`,
    `- end: ${records.at(-1) ? records.at(-1).sent_at : ""}`,
    ""
  ];
  for (const record of records) lines.push(renderRecord(record));
  return lines.join("\n") + "\n";
}

function renderRecord(record) {
  const sender = record.sender_name || record.sender_id || "未知发送人";
  const body = record.text || (record.attachments || []).map((item) => `[附件: ${item.name || item.type}]`).join(" ") || `[消息类型: ${record.message_type || "unknown"}]`;
  return `- ${record.sent_at || "未知时间"} | ${sender} | message_id=${record.message_id || ""} | ${String(body).replace(/\s+/g, " ").trim()}`;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new WoaChatError("INVALID_JSONL", `records.jsonl 第 ${index + 1} 行不是有效 JSON。`); }
  });
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(prepareSummary(args), null, 2));
  } catch (error) {
    console.error(JSON.stringify(errorPayload(error), null, 2));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
