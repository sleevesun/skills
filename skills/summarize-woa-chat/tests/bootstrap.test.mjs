import assert from "node:assert/strict";
import test from "node:test";
import { runtimeAsset } from "../scripts/bootstrap.mjs";

test("selects a pinned Windows Node 24 prebuild", () => {
  const asset = runtimeAsset({ platform: "win32", arch: "x64", abi: "137" });
  assert.equal(asset.name, "better-sqlite3-multiple-ciphers-v12.10.0-node-v137-win32-x64.tar.gz");
  assert.equal(asset.sha256, "c749483c671e4abd17507a39729a582113f855d80e1831c7a0d2991d83d97136");
});

test("supports Apple Silicon and rejects an unpinned ABI", () => {
  assert.match(runtimeAsset({ platform: "darwin", arch: "arm64", abi: "127" }).name, /darwin-arm64/);
  assert.throws(
    () => runtimeAsset({ platform: "win32", arch: "x64", abi: "131" }),
    (error) => error.code === "UNSUPPORTED_RUNTIME"
  );
});
