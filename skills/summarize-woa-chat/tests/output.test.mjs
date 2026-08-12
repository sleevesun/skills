import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareSummary } from "../scripts/prepare-summary.mjs";
import { writeFetchResult } from "../scripts/lib/output.mjs";
import { resolveTimeWindow } from "../scripts/lib/time-window.mjs";

test("writes a complete manifest and creates stable summary chunks", () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "woa-output-"));
  const window = resolveTimeWindow({ from: "2026-08-01", to: "2026-08-02" });
  const records = [
    { chat_id: "1", chat_name: "项目群", message_id: "1", sender_name: "张三", sent_at: "2026-08-01T01:00:00.000Z", text: "第一条", attachments: [] },
    { chat_id: "1", chat_name: "项目群", message_id: "2", sender_name: "李四", sent_at: "2026-08-01T02:00:00.000Z", text: "第二条", attachments: [] }
  ];
  const output = writeFetchResult({
    cacheRoot,
    target: { uid: "100", id: "1", name: "项目群", type: "group" },
    window,
    platform: "darwin",
    records,
    total: 2,
    diagnostics: { quick_check: "ok" }
  });
  assert.equal(output.manifest.coverage.complete, true);
  assert.equal(fs.existsSync(output.recordsPath), true);
  const prepared = prepareSummary({ input: output.recordsPath, maxChars: 100 });
  assert.equal(prepared.chunks, 2);
  assert.equal(fs.existsSync(prepared.index_path), true);
  fs.rmSync(cacheRoot, { recursive: true, force: true });
});
