import assert from "node:assert/strict";
import test from "node:test";
import { peerExpression, selectColumns } from "../scripts/lib/query.mjs";
import { buildMacPageExpression } from "../scripts/lib/macos.mjs";

test("builds a chat-id peer filter instead of querying all chats", () => {
  assert.match(peerExpression(), /CASE WHEN/);
  assert.match(peerExpression(), /CAST\(\"to\" AS TEXT\)/);
  const expression = buildMacPageExpression({
    woaRoot: "/tmp/WOA",
    uid: "100",
    chatId: "200",
    startMs: 1,
    endMs: 2,
    limit: 100,
    offset: 0
  });
  assert.match(expression, /CASE WHEN CAST\("to" AS TEXT\)/);
  assert.match(expression, /LIMIT \? OFFSET \?/);
});

test("selects only optional columns that exist", () => {
  const selected = selectColumns(["id", "from", "to", "ctime", "content", "type", "extra"]);
  assert.match(selected, /"type" AS "type"/);
  assert.match(selected, /"extra" AS "extra"/);
  assert.doesNotMatch(selected, /senderIdentity/);
});
