import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRows } from "../scripts/lib/normalize.mjs";

test("normalizes rows, sender names, attachments, and redacts secrets", () => {
  const records = normalizeRows([{
    id: 10,
    from_uid: "u1",
    to_uid: "group1",
    ctime: 1786500000000,
    type: 1,
    content: JSON.stringify({
      text: "已处理 token=secret-value",
      image: { fileName: "shot.png", type: "image", url: "https://example.test/x?signature=secret" }
    }),
    senderIdentity: JSON.stringify({ name: "张三" })
  }], { uid: "self", chatId: "group1", chatName: "项目群", chatType: "group" });
  assert.equal(records.length, 1);
  assert.equal(records[0].sender_name, "张三");
  assert.match(records[0].text, /token=\[REDACTED\]/);
  assert.deepEqual(records[0].attachments, [{
    name: "shot.png",
    type: "image",
    size: "",
    extracted_text: "",
    status: "metadata_only"
  }]);
  assert.equal(JSON.stringify(records[0]).includes("secret-value"), false);
});

test("deduplicates identical message ids", () => {
  const rows = [
    { id: 1, from_uid: "a", to_uid: "b", ctime: 1000, content: '{"text":"one"}' },
    { id: 1, from_uid: "a", to_uid: "b", ctime: 1000, content: '{"text":"one"}' }
  ];
  assert.equal(normalizeRows(rows, { uid: "a", chatId: "b" }).length, 1);
});

test("does not mistake row metadata for message text", () => {
  const [record] = normalizeRows([
    { id: 1, from_uid: "sender-id", to_uid: "chat-id", ctime: 1000, content: "{}" }
  ], { uid: "self", chatId: "chat-id" });
  assert.equal(record.text, "");
});
