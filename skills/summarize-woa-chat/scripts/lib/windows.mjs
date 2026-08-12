import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WoaChatError } from "./errors.mjs";
import { readTargetMessages } from "./query.mjs";

const require = createRequire(import.meta.url);
const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function windowsDependencyStatus() {
  try {
    const resolved = require.resolve("better-sqlite3-multiple-ciphers", { paths: [SKILL_ROOT] });
    return { available: true, resolved };
  } catch {
    return { available: false };
  }
}

export function inspectWindowsAccount(woaRoot, uid) {
  const paths = resolveWindowsAccountPaths(woaRoot, uid);
  return {
    uid: String(uid),
    local_state: fs.existsSync(paths.localState),
    key_file: fs.existsSync(paths.keyFile),
    database: fs.existsSync(paths.database)
  };
}

export function readWindowsMessages(options) {
  const dependency = windowsDependencyStatus();
  if (!dependency.available) {
    throw new WoaChatError("DEPENDENCY_MISSING", "缺少 Windows SQLCipher 读取依赖，请先运行 node scripts/bootstrap.mjs。");
  }
  const paths = resolveWindowsAccountPaths(options.woaRoot, options.uid);
  assertWindowsPaths(paths);
  const masterKey = decryptWindowsMasterKey(paths.localState, options.runPowerShell);
  let sqlcipherKey;
  try {
    sqlcipherKey = decryptSqlcipherKey(masterKey, fs.readFileSync(paths.keyFile));
  } finally {
    masterKey.fill(0);
  }

  const Database = require("better-sqlite3-multiple-ciphers");
  let lastError;
  const attempts = Number(options.snapshotAttempts || 3);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const snapshot = createDatabaseSnapshot(paths.database);
    let db;
    try {
      db = new Database(snapshot.database, { readonly: true, fileMustExist: true });
      db.pragma("cipher=sqlcipher");
      db.pragma("legacy=4");
      db.pragma(`key=${JSON.stringify(sqlcipherKey)}`);
      const quickCheck = db.pragma("quick_check", { simple: true });
      if (String(quickCheck).toLowerCase() !== "ok") {
        throw new WoaChatError("DATABASE_CHECK_FAILED", `WOA 数据库 quick_check 返回 ${quickCheck}。`);
      }
      const result = readTargetMessages(db, {
        uid: options.uid,
        chatId: options.chatId,
        startMs: options.startMs,
        endMs: options.endMs,
        pageSize: options.pageSize,
        maxMessages: options.maxMessages
      });
      return {
        ...result,
        diagnostics: {
          quick_check: quickCheck,
          schema_columns: result.columns,
          pages: Math.ceil(result.total / Number(options.pageSize || 2000)),
          snapshot_attempts: attempt
        }
      };
    } catch (error) {
      lastError = error;
      if (error && ["MESSAGE_LIMIT_EXCEEDED", "UNSUPPORTED_SCHEMA"].includes(error.code)) throw error;
    } finally {
      try { if (db) db.close(); } catch {}
      snapshot.cleanup();
    }
  }
  if (lastError && lastError.code) throw lastError;
  throw new WoaChatError("DATABASE_READ_FAILED", `Windows WOA 数据库快照读取失败：${lastError ? lastError.message : "未知错误"}`);
}

export function resolveWindowsAccountPaths(woaRoot, uid) {
  const accountHash = crypto.createHash("md5").update(`${uid}_v1`).digest("hex");
  const keyHash = crypto.createHash("sha1").update(`${uid}:messages`).digest("hex");
  const kimRoot = path.join(woaRoot, "kim");
  let keyFile = path.join(kimRoot, keyHash.slice(0, 32));
  if (!fs.existsSync(keyFile) && fs.existsSync(kimRoot)) {
    const match = fs.readdirSync(kimRoot).find((name) => keyHash.startsWith(name));
    if (match) keyFile = path.join(kimRoot, match);
  }
  return {
    localState: path.join(woaRoot, "Local State"),
    keyFile,
    database: path.join(kimRoot, accountHash, "ksxz-messages.sqlite")
  };
}

export function decryptWindowsMasterKey(localStatePath, runPowerShell = defaultRunPowerShell) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(localStatePath, "utf8"));
  } catch {
    throw new WoaChatError("LOCAL_STATE_INVALID", "无法读取 WOA Local State。");
  }
  const encoded = state && state.os_crypt && state.os_crypt.encrypted_key;
  if (!encoded) {
    throw new WoaChatError("LOCAL_STATE_INVALID", "WOA Local State 中缺少 os_crypt.encrypted_key。");
  }
  const encrypted = Buffer.from(String(encoded), "base64");
  const prefix = encrypted.subarray(0, 5).toString("ascii");
  if (prefix !== "DPAPI") {
    throw new WoaChatError("LOCAL_STATE_INVALID", "WOA master key 不是预期的 DPAPI 格式。");
  }
  const result = runPowerShell(encrypted.subarray(5).toString("base64"));
  if (!result || result.status !== 0 || !String(result.stdout || "").trim()) {
    throw new WoaChatError("DPAPI_FAILED", "Windows DPAPI 解密失败；必须使用加密该数据的 Windows 用户运行。", {
      powershell_status: result ? result.status : null
    });
  }
  return Buffer.from(String(result.stdout).trim(), "base64");
}

export function decryptSqlcipherKey(masterKey, keyFile) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new WoaChatError("DPAPI_FAILED", "DPAPI master key 长度不是 32 字节。");
  }
  if (!Buffer.isBuffer(keyFile) || keyFile.length < 32) {
    throw new WoaChatError("KEY_FILE_INVALID", "WOA SQLCipher 密钥文件格式不正确。");
  }
  const version = keyFile.subarray(0, 3).toString("ascii");
  if (version !== "v10" && version !== "v11") {
    throw new WoaChatError("KEY_FILE_INVALID", `不支持的 WOA 密钥文件版本：${version}。`);
  }
  const nonce = keyFile.subarray(3, 15);
  const tag = keyFile.subarray(keyFile.length - 16);
  const ciphertext = keyFile.subarray(15, keyFile.length - 16);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, nonce);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const key = decrypted.toString("utf8").trim();
    decrypted.fill(0);
    if (!key) throw new Error("empty key");
    return key;
  } catch {
    throw new WoaChatError("KEY_DECRYPT_FAILED", "WOA SQLCipher 密钥 AES-GCM 解密失败。");
  }
}

function defaultRunPowerShell(encryptedBlobBase64) {
  const script = [
    "[Reflection.Assembly]::LoadWithPartialName('System.Security') | Out-Null",
    `$blob = [Convert]::FromBase64String('${encryptedBlobBase64}')`,
    "$key = [Security.Cryptography.ProtectedData]::Unprotect($blob, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($key))"
  ].join("\n");
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  for (const command of ["powershell.exe", "pwsh.exe", "pwsh"]) {
    const result = spawnSync(command, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    if (!result.error || result.error.code !== "ENOENT") return result;
  }
  return { status: 1, stdout: "", stderr: "PowerShell not found" };
}

function createDatabaseSnapshot(databasePath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "woa-chat-snapshot-"));
  const target = path.join(dir, "ksxz-messages.sqlite");
  fs.copyFileSync(databasePath, target);
  for (const suffix of ["-wal", "-shm"]) {
    const source = databasePath + suffix;
    if (fs.existsSync(source)) fs.copyFileSync(source, target + suffix);
  }
  return {
    database: target,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  };
}

function assertWindowsPaths(paths) {
  const missing = Object.entries(paths).filter(([, value]) => !fs.existsSync(value)).map(([name]) => name);
  if (missing.length) {
    throw new WoaChatError("WOA_DATA_INCOMPLETE", `Windows WOA 数据文件不完整：${missing.join(", ")}。`);
  }
}
