import assert from "node:assert/strict";
import test from "node:test";
import { resolveTimeWindow } from "../scripts/lib/time-window.mjs";

test("defaults to a rolling 15 day window", () => {
  const window = resolveTimeWindow({ now: "2026-08-12T04:00:00.000Z" });
  assert.equal(window.startIso, "2026-07-28T04:00:00.000Z");
  assert.equal(window.endIso, "2026-08-12T04:00:00.000Z");
  assert.equal(window.timezone, "Asia/Shanghai");
});

test("treats a date-only end as inclusive in Asia/Shanghai", () => {
  const window = resolveTimeWindow({ from: "2026-08-01", to: "2026-08-12" });
  assert.equal(window.startIso, "2026-07-31T16:00:00.000Z");
  assert.equal(window.endIso, "2026-08-12T16:00:00.000Z");
  assert.equal(window.endLocal, "2026-08-13 00:00:00");
});

test("accepts an open-ended from time", () => {
  const window = resolveTimeWindow({ from: "2026-08-01 09:30", now: "2026-08-12T04:00:00.000Z" });
  assert.equal(window.startIso, "2026-08-01T01:30:00.000Z");
  assert.equal(window.endIso, "2026-08-12T04:00:00.000Z");
});
