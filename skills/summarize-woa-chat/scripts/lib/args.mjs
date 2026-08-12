import { WoaChatError } from "./errors.mjs";

export function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    const rawKey = equal >= 0 ? token.slice(2, equal) : token.slice(2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = equal >= 0 ? token.slice(equal + 1) : argv[index + 1];
    if (equal < 0 && (next === undefined || next.startsWith("--"))) {
      result[key] = true;
      continue;
    }
    if (equal < 0) index += 1;
    result[key] = coerce(next);
  }
  return result;
}

export function positiveInteger(value, fallback, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new WoaChatError("INVALID_ARGUMENT", `${name} 必须是正整数。`);
  }
  return number;
}

function coerce(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(String(value))) return Number(value);
  return value;
}
