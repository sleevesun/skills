import os from "node:os";
import path from "node:path";
import { WoaChatError } from "./errors.mjs";

export function supportedPlatform(platform = process.platform) {
  return platform === "darwin" || platform === "win32";
}

export function resolveWoaRoot(options = {}) {
  if (options.woaRoot) return path.resolve(String(options.woaRoot));
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "WOA");
  }
  if (platform === "win32") {
    const appData = env.APPDATA || (env.USERPROFILE
      ? path.join(env.USERPROFILE, "AppData", "Roaming")
      : "");
    if (!appData) {
      throw new WoaChatError("WOA_ROOT_NOT_FOUND", "无法确定 Windows APPDATA 目录。");
    }
    return path.join(appData, "WOA");
  }
  throw new WoaChatError("UNSUPPORTED_PLATFORM", `仅支持 macOS 和 Windows，当前平台为 ${platform}。`);
}

export function resolveCacheRoot(options = {}) {
  if (options.cacheRoot) return path.resolve(String(options.cacheRoot));
  if (process.env.WOA_CHAT_CACHE_ROOT) {
    return path.resolve(process.env.WOA_CHAT_CACHE_ROOT);
  }
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  if (platform === "darwin") {
    return path.join(home, "Library", "Caches", "summarize-woa-chat");
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || (env.USERPROFILE
      ? path.join(env.USERPROFILE, "AppData", "Local")
      : "");
    if (!localAppData) {
      throw new WoaChatError("CACHE_ROOT_NOT_FOUND", "无法确定 Windows LOCALAPPDATA 目录。");
    }
    return path.join(localAppData, "summarize-woa-chat", "cache");
  }
  throw new WoaChatError("UNSUPPORTED_PLATFORM", `仅支持 macOS 和 Windows，当前平台为 ${platform}。`);
}

export function runtimeDescriptor() {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    abi: process.versions.modules
  };
}
