import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalTime, resetCountdown } from "../client/time";

test("compact and full timestamps use the same local day, 24-hour clock and actual offset", () => {
  const now = Date.parse("2026-11-26T05:32:00Z");
  const instant = "2026-11-26T22:32:00Z";
  const shanghai = createLocalTime("Asia/Shanghai");
  assert.equal(shanghai(instant, now)?.short, "明天 06:32");
  assert.match(shanghai(instant, now)!.full, /2026年11月27日/);
  assert.match(shanghai(instant, now)!.full, /06:32:00/);
  assert.match(shanghai(instant, now)!.full, /中国标准时间/);
  assert.match(shanghai(instant, now)!.full, /GMT\+8/);
  assert.equal(createLocalTime("UTC")(instant, now)?.short, "今天 22:32");
  assert.equal(shanghai("2026-12-01T16:00:00Z", now)?.short, "12月2日 00:00");
  assert.equal(shanghai("invalid", now), null);
});

test("a daylight-saving change distinguishes the two local 01:30 observations", () => {
  const newYork = createLocalTime("America/New_York");
  const now = Date.parse("2026-11-01T03:50:00Z");
  const first = newYork("2026-11-01T05:30:00Z", now)!;
  const second = newYork("2026-11-01T06:30:00Z", now)!;
  assert.equal(first.short, "明天 01:30");
  assert.equal(second.short, first.short);
  assert.match(first.full, /GMT-4/);
  assert.match(second.full, /GMT-5/);
});

test("countdowns omit zero units and preserve elapsed and unknown windows", () => {
  const at = "2026-12-02T10:00:00Z";
  assert.equal(resetCountdown(at, Date.parse("2026-11-30T10:00Z")), "2天后");
  assert.equal(resetCountdown(at, Date.parse("2026-12-02T07:00Z")), "3小时后");
  assert.equal(resetCountdown(at, Date.parse("2026-12-02T08:54Z")), "1小时6分后");
  assert.equal(resetCountdown(at, Date.parse("2026-12-02T09:59:30Z")), "1分钟后");
  assert.equal(resetCountdown(at, Date.parse(at)), "重置时间已过");
  assert.equal(resetCountdown("unknown", Date.parse(at)), null);
});
