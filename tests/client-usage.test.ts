import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { antigravitySnapshot } from "../shared/native-usage";

const nativeData: Parameters<typeof antigravitySnapshot>[0] =
  JSON.parse(readFileSync("fixtures/native/provider-list.mock.json", "utf8"));

test("preserves every reported Antigravity model or shared-group window, including non-summary and disabled rows", () => {
  const source = antigravitySnapshot(nativeData);
  assert.equal(source.accounts.length, 1);
  const [account] = source.accounts;
  assert.equal(account.observedAt, null);
  assert.deepEqual(account.windows.map(({ label, usedPercent, resetAt }) => [label, usedPercent, resetAt]), [
    ["Gemini Pro · 5h", 25, "2026-11-26T09:45:00Z"],
    ["Gemini Pro · Weekly", 50, "2026-11-30T01:00:00Z"],
    ["Gemini Flash · 5h", 0, null],
    ["Gemini Flash · Weekly", 100, "2026-11-30T05:00:00Z"],
    ["Claude and GPT · Weekly", 75, "2026-12-01T06:00:00Z"],
    ["Claude and GPT · Monthly · Disabled", null, null],
  ]);
  const ids = account.windows.map(window => window.id);
  assert.equal(new Set(ids).size, ids.length);
  const [report] = nativeData.providers;
  const reordered = antigravitySnapshot({ providers: [{ ...report, windows: report.windows.toReversed() }] });
  assert.deepEqual(reordered.accounts[0].windows.map(window => window.id), ids.toReversed());
  assert.deepEqual(antigravitySnapshot({ providers: [] }).accounts, []);
});

test("keeps separate reports and repeated window labels when the host supplies identical identifiers", () => {
  const [report] = nativeData.providers;
  const [first] = report.windows;
  const second = { ...first, usedPct: null, remainingPct: 31 };
  const { accounts } = antigravitySnapshot({ providers: [report, { ...report, windows: [first, second] }] });
  assert.equal(accounts.length, 2);
  assert.notEqual(accounts[0].id, accounts[1].id);
  const [a, b] = accounts[1].windows;
  assert.notEqual(a.id, b.id);
  assert.deepEqual([a.label, b.label], [first.label, first.label]);
  assert.deepEqual([a.usedPercent, b.usedPercent], [25, 69]);
});
