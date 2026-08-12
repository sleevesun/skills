import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverAccounts, resolveChat, searchChats } from "../scripts/lib/chat-index.mjs";

test("discovers accounts and resolves an exact chat name", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "woa-index-"));
  fs.writeFileSync(path.join(root, "browser.history.100.json"), JSON.stringify({
    nested: [
      { id: 1, name: "项目讨论群", isGroupChat: true },
      { chatId: 2, chatName: "张三", isGroupChat: false }
    ]
  }));
  const accounts = discoverAccounts(root);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].chats.length, 2);
  assert.deepEqual(resolveChat(accounts, { chat: " 项目 讨论群 " }), {
    uid: "100",
    id: "1",
    name: "项目讨论群",
    type: "group"
  });
  assert.equal(searchChats(accounts, "张三")[0].type, "single");
  fs.rmSync(root, { recursive: true, force: true });
});

test("requires disambiguation for duplicate chat names across accounts", () => {
  const accounts = [
    { uid: "100", chats: [{ id: "1", name: "项目群", type: "group" }] },
    { uid: "200", chats: [{ id: "2", name: "项目群", type: "group" }] }
  ];
  assert.throws(
    () => resolveChat(accounts, { chat: "项目群" }),
    (error) => error.code === "AMBIGUOUS_CHAT" && error.details.candidates.length === 2
  );
  assert.equal(resolveChat(accounts, { chat: "项目群", uid: "200" }).id, "2");
});

test("allows an explicit chat id when only one account exists", () => {
  const target = resolveChat([{ uid: "100", chats: [] }], { chatId: "999" });
  assert.deepEqual(target, { uid: "100", id: "999", name: "999", type: "unknown" });
});
