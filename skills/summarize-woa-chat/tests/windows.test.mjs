import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import {
  decryptSqlcipherKey,
  readWindowsMessages,
  resolveWindowsAccountPaths,
  windowsDependencyStatus
} from "../scripts/lib/windows.mjs";

const require = createRequire(import.meta.url);

test("decrypts the Windows v10 AES-GCM SQLCipher key file", () => {
  const master = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const expected = "12345678901234567890123456789012";
  const cipher = crypto.createCipheriv("aes-256-gcm", master, nonce);
  const ciphertext = Buffer.concat([cipher.update(expected, "utf8"), cipher.final()]);
  const keyFile = Buffer.concat([Buffer.from("v10"), nonce, ciphertext, cipher.getAuthTag()]);
  assert.equal(decryptSqlcipherKey(master, keyFile), expected);
});

test("rejects an unknown Windows key file version", () => {
  assert.throws(
    () => decryptSqlcipherKey(Buffer.alloc(32), Buffer.concat([Buffer.from("v99"), Buffer.alloc(60)])),
    (error) => error.code === "KEY_FILE_INVALID"
  );
});

test("reads only the target chat from a Windows-style encrypted snapshot", {
  skip: !windowsDependencyStatus().available
}, () => {
  const Database = require("better-sqlite3-multiple-ciphers");
  const woaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "woa-windows-fixture-"));
  const uid = "10001";
  const paths = resolveWindowsAccountPaths(woaRoot, uid);
  fs.mkdirSync(path.dirname(paths.database), { recursive: true });
  fs.mkdirSync(path.dirname(paths.keyFile), { recursive: true });
  fs.writeFileSync(paths.localState, JSON.stringify({
    os_crypt: { encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.from("fixture")]).toString("base64") }
  }));

  const master = crypto.randomBytes(32);
  const sqlcipherKey = "12345678901234567890123456789012";
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master, nonce);
  const ciphertext = Buffer.concat([cipher.update(sqlcipherKey, "utf8"), cipher.final()]);
  fs.writeFileSync(paths.keyFile, Buffer.concat([Buffer.from("v10"), nonce, ciphertext, cipher.getAuthTag()]));

  const db = new Database(paths.database);
  db.pragma("cipher=sqlcipher");
  db.pragma("legacy=4");
  db.pragma(`key=${JSON.stringify(sqlcipherKey)}`);
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, "from" TEXT, "to" TEXT, ctime INTEGER, content TEXT, type INTEGER)');
  const insert = db.prepare('INSERT INTO messages (id, "from", "to", ctime, content, type) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run(1, "sender-a", "group-1", 1000, '{"text":"target"}', 1);
  insert.run(2, "sender-b", "group-2", 1000, '{"text":"other"}', 1);
  db.close();

  const result = readWindowsMessages({
    woaRoot,
    uid,
    chatId: "group-1",
    startMs: 0,
    endMs: 2000,
    pageSize: 10,
    maxMessages: 100,
    runPowerShell() {
      return { status: 0, stdout: master.toString("base64"), stderr: "" };
    }
  });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].id, 1);
  assert.equal(result.rows[0].content, '{"text":"target"}');
  fs.rmSync(woaRoot, { recursive: true, force: true });
});
