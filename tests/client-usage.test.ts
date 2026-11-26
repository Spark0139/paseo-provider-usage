import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { antigravitySnapshot } from "../shared/native-usage";

const nativeData: Parameters<typeof antigravitySnapshot>[0] =
  JSON.parse(readFileSync("fixtures/native/provider-list.mock.json", "utf8"));
const [report] = nativeData.providers;
const [fiveHour, weekly] = report.windows;

test("shows every native quota period and reset once per pool", () => {
  const { accounts } = antigravitySnapshot(nativeData);
  assert.equal(accounts.length, 1);
  const [account] = accounts;
  assert.equal(account.observedAt, null);
  assert.deepEqual(account.windows.map(w => [w.groupLabel, w.label, w.usedPercent, w.resetAt]), [
    ["Gemini", "5 小时", 25, "2026-11-26T09:45:00Z"],
    ["Gemini", "7 天", 50, "2026-11-30T01:00:00Z"],
    ["Claude / GPT", "5 小时", 0, null],
    ["Claude / GPT", "7 天", 75, "2026-12-01T06:00:00Z"],
  ]);
  assert.deepEqual(antigravitySnapshot({ providers: [] }).accounts, []);
});

test("numbers distinctly named pools within a family without displaying model names or guessing periods", () => {
  const windows = [
    { ...fiveHour, label: "Gemini Pro · 5h" },
    { ...weekly, label: "Gemini Pro · Weekly", usedPct: 15 },
    { ...weekly, label: "Gemini Flash · Weekly", usedPct: 20 },
    { ...weekly, label: "Custom model · Custom limit · Disabled", shortLabel: "Custom model new",
      durationSeconds: undefined, usedPct: null, remainingPct: null, resetsAt: null },
  ];
  const map = (items: typeof windows) => antigravitySnapshot({ providers: [{ ...report, windows: items }] }).accounts[0].windows;
  const results = map(windows);
  assert.deepEqual(results.map(w => [w.groupLabel, w.label, w.usedPercent, w.status]), [
    ["Gemini 额度组 2", "5 小时", 25, undefined],
    ["Gemini 额度组 2", "7 天", 15, undefined],
    ["Gemini 额度组 1", "7 天", 20, undefined],
    ["额度组 1", "额度窗口", null, "disabled"],
  ]);
  assert.deepEqual(results, map(windows.toReversed()).toReversed());
});

test("keeps repeated buckets and accounts independent even when display names and IDs coincide", () => {
  const repeated = { ...fiveHour, usedPct: null, remainingPct: 31 };
  const { accounts } = antigravitySnapshot({ providers: [report, { ...report, windows: [fiveHour, repeated] }] });
  assert.notEqual(accounts[0].id, accounts[1].id);
  const [a, b] = accounts[1].windows;
  assert.notEqual(a.id, b.id);
  assert.deepEqual([a.label, b.label], ["5 小时 · 窗口 1", "5 小时 · 窗口 2"]);
  assert.deepEqual([a.usedPercent, b.usedPercent], [25, 69]);
});
