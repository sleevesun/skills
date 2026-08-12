#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { WoaChatError, errorPayload } from "./lib/errors.mjs";

const VERSION = "12.10.0";
const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = [
  ["better-sqlite3-multiple-ciphers", VERSION],
  ["bindings", "1.5.0"],
  ["file-uri-to-path", "1.0.0"]
];

const NATIVE_SHA256 = {
  "node-v127-darwin-arm64": "1a4ce474bf4653dd840166083724651c6c2e2208ea37f83507f199fcbe296aea",
  "node-v127-darwin-x64": "d35f7435736a8932617641c2adc6786918ad032575e501bf7fb2bccd76cd0687",
  "node-v127-win32-arm64": "a25f585500845c4358dfadd43bd34132d0e122c5b240654a78c4213ad4104d2d",
  "node-v127-win32-x64": "1616f562657939dd16f8913526a698b917602128989e9b6ee20089abc7069dc3",
  "node-v137-darwin-arm64": "1710cafa09d02b7806739c47e36a4b1dae8aeea7bd8c8e966218b385ed7746c8",
  "node-v137-darwin-x64": "2abbb04e1538083c36195ecddba14ef2ead8e79cddb87388445dde719d06e1ea",
  "node-v137-win32-arm64": "2e8010f3d91f06cdfbef762fc1c04362aa6adc57b0294b9475576423c90b4b8d",
  "node-v137-win32-x64": "c749483c671e4abd17507a39729a582113f855d80e1831c7a0d2991d83d97136",
  "node-v147-darwin-arm64": "2b5e302adaf1bb8078c2998614fb6601966ec0577cabb50550f89a243b021dd9",
  "node-v147-darwin-x64": "804450faa4c66c3213e8f655f0ee40a906c8fefb735a897788580b943f64800a",
  "node-v147-win32-arm64": "558358f9edf1bf7f2ff528635ec2917dacd0f8afd63e1c6dca86abaf1a05e9cf",
  "node-v147-win32-x64": "f88d8f899a8b14d882d68548c22d48b76b5f2294f4b4dc2d6cf3a3bfd8149602"
};

export function runtimeAsset(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const abi = String(options.abi || process.versions.modules);
  const key = `node-v${abi}-${platform}-${arch}`;
  const sha256 = NATIVE_SHA256[key];
  if (!sha256) {
    throw new WoaChatError(
      "UNSUPPORTED_RUNTIME",
      `没有适用于 ${platform}/${arch}/Node ABI ${abi} 的固定预构建。请使用 Node.js 22、24 或 26。`,
      { platform, arch, abi }
    );
  }
  const name = `better-sqlite3-multiple-ciphers-v${VERSION}-${key}.tar.gz`;
  return {
    key,
    name,
    sha256,
    url: `https://github.com/m4heshd/better-sqlite3-multiple-ciphers/releases/download/v${VERSION}/${name}`
  };
}

export async function bootstrap(options = {}) {
  const skillRoot = options.skillRoot || SKILL_ROOT;
  const asset = runtimeAsset(options.runtime);
  const stage = fs.mkdtempSync(path.join(skillRoot, ".woa-bootstrap-"));
  const nodeModules = path.join(stage, "node_modules");
  fs.mkdirSync(nodeModules, { recursive: true });
  let backup = "";
  try {
    for (const [name, version] of PACKAGES) {
      await installNpmTarball(name, version, nodeModules, stage);
    }
    const nativeArchive = path.join(stage, asset.name);
    const nativeBytes = await download(asset.url);
    verifyDigest(nativeBytes, "sha256", asset.sha256, asset.name);
    fs.writeFileSync(nativeArchive, nativeBytes, { mode: 0o600 });
    extractArchive(nativeArchive, path.join(nodeModules, "better-sqlite3-multiple-ciphers"), 0);
    probeModule(nodeModules);

    const finalModules = path.join(skillRoot, "node_modules");
    if (fs.existsSync(finalModules)) {
      backup = path.join(skillRoot, `.node_modules-backup-${process.pid}-${Date.now()}`);
      fs.renameSync(finalModules, backup);
    }
    fs.renameSync(nodeModules, finalModules);
    if (backup) fs.rmSync(backup, { recursive: true, force: true });
    return {
      status: "done",
      dependency: `better-sqlite3-multiple-ciphers@${VERSION}`,
      runtime: asset.key,
      installed_to: finalModules
    };
  } catch (error) {
    const finalModules = path.join(skillRoot, "node_modules");
    if (backup && !fs.existsSync(finalModules) && fs.existsSync(backup)) {
      fs.renameSync(backup, finalModules);
      backup = "";
    }
    throw error;
  } finally {
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    if (backup) {
      try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
    }
  }
}

async function installNpmTarball(name, version, nodeModules, stage) {
  const encodedName = encodeURIComponent(name).replace(/^%40/, "@");
  const metadata = await fetchJson(`https://registry.npmjs.org/${encodedName}/${version}`);
  const dist = metadata && metadata.dist;
  if (!dist || !dist.tarball || !dist.integrity) {
    throw new WoaChatError("BOOTSTRAP_METADATA_INVALID", `npm 元数据缺失：${name}@${version}。`);
  }
  const bytes = await download(dist.tarball);
  verifyIntegrity(bytes, dist.integrity, `${name}@${version}`);
  const archive = path.join(stage, `${name.replace(/\//g, "-")}-${version}.tgz`);
  const destination = path.join(nodeModules, ...name.split("/"));
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(archive, bytes, { mode: 0o600 });
  extractArchive(archive, destination, 1);
}

function extractArchive(archive, destination, stripComponents) {
  const args = ["-xzf", archive, "-C", destination];
  if (stripComponents) args.push(`--strip-components=${stripComponents}`);
  const result = spawnSync("tar", args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new WoaChatError("BOOTSTRAP_EXTRACT_FAILED", `无法解压 ${path.basename(archive)}：${String(result.stderr || "").trim()}`);
  }
}

function probeModule(nodeModules) {
  const stageRequire = createRequire(path.join(nodeModules, "__woa_probe.cjs"));
  let Database;
  try {
    Database = stageRequire("better-sqlite3-multiple-ciphers");
  } catch (error) {
    throw new WoaChatError("BOOTSTRAP_PROBE_FAILED", `SQLCipher native 模块加载失败：${error.message}`);
  }
  if (typeof Database !== "function") {
    throw new WoaChatError("BOOTSTRAP_PROBE_FAILED", "SQLCipher native 模块未导出 Database 构造函数。");
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "user-agent": "summarize-woa-chat-skill" } });
  if (!response.ok) throw new WoaChatError("BOOTSTRAP_DOWNLOAD_FAILED", `请求失败 ${response.status}：${url}`);
  return response.json();
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "summarize-woa-chat-skill" } });
  if (!response.ok) throw new WoaChatError("BOOTSTRAP_DOWNLOAD_FAILED", `下载失败 ${response.status}：${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function verifyIntegrity(bytes, integrity, label) {
  const [algorithm, encoded] = String(integrity).split("-", 2);
  if (!algorithm || !encoded) throw new WoaChatError("BOOTSTRAP_INTEGRITY_INVALID", `${label} 的 npm integrity 格式无效。`);
  const actual = crypto.createHash(algorithm).update(bytes).digest("base64");
  if (actual !== encoded) throw new WoaChatError("BOOTSTRAP_INTEGRITY_FAILED", `${label} 的完整性校验失败。`);
}

function verifyDigest(bytes, algorithm, expected, label) {
  const actual = crypto.createHash(algorithm).update(bytes).digest("hex");
  if (actual !== expected) throw new WoaChatError("BOOTSTRAP_INTEGRITY_FAILED", `${label} 的 ${algorithm} 校验失败。`);
}

async function main() {
  try {
    console.log(JSON.stringify(await bootstrap(), null, 2));
  } catch (error) {
    console.error(JSON.stringify(errorPayload(error), null, 2));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
