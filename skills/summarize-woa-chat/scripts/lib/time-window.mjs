import { WoaChatError } from "./errors.mjs";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveTimeWindow(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  assertValidDate(now, "now");
  let start;
  let end;

  if (options.from || options.to) {
    if (!options.from) {
      throw new WoaChatError("INVALID_TIME_WINDOW", "指定 --to 时必须同时指定 --from。");
    }
    start = parseShanghaiInput(options.from, false);
    end = options.to ? parseShanghaiInput(options.to, true) : now;
  } else {
    const days = Number(options.days ?? 15);
    if (!Number.isFinite(days) || days <= 0) {
      throw new WoaChatError("INVALID_TIME_WINDOW", "--days 必须大于 0。");
    }
    end = now;
    start = new Date(end.getTime() - days * DAY_MS);
  }

  if (!(start < end)) {
    throw new WoaChatError("INVALID_TIME_WINDOW", "起始时间必须早于结束时间。");
  }
  return {
    timezone: "Asia/Shanghai",
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startLocal: formatShanghai(start),
    endLocal: formatShanghai(end),
    label: `${compact(start)}_${compact(end)}`
  };
}

export function parseShanghaiInput(value, dateOnlyAsInclusiveEnd = false) {
  const raw = String(value).trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const date = fromShanghaiParts(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
      0,
      0,
      0
    );
    return dateOnlyAsInclusiveEnd ? new Date(date.getTime() + DAY_MS) : date;
  }
  const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T_](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    return fromShanghaiParts(
      Number(local[1]),
      Number(local[2]),
      Number(local[3]),
      Number(local[4]),
      Number(local[5]),
      Number(local[6] || 0)
    );
  }
  const parsed = new Date(raw);
  assertValidDate(parsed, raw);
  return parsed;
}

function fromShanghaiParts(year, month, day, hour, minute, second) {
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - SHANGHAI_OFFSET_MS);
  const roundTrip = shanghaiParts(value);
  if (
    roundTrip.year !== year || roundTrip.month !== month || roundTrip.day !== day ||
    roundTrip.hour !== hour || roundTrip.minute !== minute || roundTrip.second !== second
  ) {
    throw new WoaChatError("INVALID_TIME_WINDOW", "日期时间不合法。");
  }
  return value;
}

function shanghaiParts(date) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds()
  };
}

function formatShanghai(date) {
  const value = shanghaiParts(date);
  return `${pad(value.year, 4)}-${pad(value.month)}-${pad(value.day)} ${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`;
}

function compact(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function assertValidDate(date, label) {
  if (Number.isNaN(date.getTime())) {
    throw new WoaChatError("INVALID_TIME_WINDOW", `无法解析时间：${label}`);
  }
}
