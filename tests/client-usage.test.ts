import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { antigravitySnapshot, countdown, localDate } from "../client/usage";

test("native reports preserve Antigravity windows and leave unreported measurements unknown", () => {
  const data = JSON.parse(readFileSync("fixtures/native/provider-list.mock.json", "utf8"));
  const source = antigravitySnapshot(data);
  assert.equal(source.accounts.length, 1);
  assert.equal(source.accounts[0].observedAt, null);
  assert.deepEqual(source.accounts[0].windows.map(({ label, usedPercent, resetAt }) => [label, usedPercent, resetAt]), [
    ["Model group · Weekly", 33, "2026-11-30T01:00:00Z"],
    ["Model group · Disabled", null, null],
  ]);
  assert.deepEqual(antigravitySnapshot({ providers: [] }).accounts, []);
});

test("the same reset instant shows the client calendar date and a zone-independent countdown", () => {
  const reset = "2026-11-26T22:32:00Z";
  const now = Date.parse("2026-11-26T05:32:00Z");
  assert.match(localDate(reset, "en-US", "Asia/Shanghai"), /Nov 27, 2026.*06:32/);
  assert.match(localDate(reset, "en-US", "UTC"), /Nov 26, 2026.*10:32/);
  assert.equal(countdown(reset, now), "17 小时 0 分钟后");
  assert.equal(countdown(reset, Date.parse(reset)), "重置时间已过");
});
