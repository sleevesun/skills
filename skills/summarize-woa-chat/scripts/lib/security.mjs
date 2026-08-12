const SECRET_KEY_RE = /(access[_-]?token|refresh[_-]?token|token|cookie|authorization|secret|signature|sign|session|sid|ticket|credential|password)/i;
const URL_SECRET_PARAM_RE = /([?&])([^=&]*(?:token|ticket|sign|signature|key|session|sid|credential|auth)[^=]*)=([^&#]*)/gi;

export function redactSecrets(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth > 8) return "[MaxDepth]";
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redactSecrets(item, depth + 1, seen));
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY_RE.test(key) ? "[REDACTED]" : redactSecrets(item, depth + 1, seen);
  }
  return result;
}

export function redactString(value) {
  return String(value)
    .replace(/\$entry\([^)]+\)\$\/[^\s)\]]+/g, "[WOA_ENTRY_REDACTED]")
    .replace(URL_SECRET_PARAM_RE, "$1$2=[REDACTED]")
    .replace(/(\b(?:password|passwd|pwd|access[_-]?token|refresh[_-]?token|token|cookie|signature|session|ticket|authorization)\b\s*[:=]\s*)([^\s,;，；]+)/gi, "$1[REDACTED]")
    .replace(/((?:密码|口令)\s*[:：=]\s*)([^\s,;，；]+)/g, "$1[REDACTED]")
    .replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, "[REDACTED]");
}
