import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { expandProviderSnapshot } from "@getpaseo/protocol/provider-snapshot-codec";
import { antigravityGroups } from "../shared/antigravity-models";
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

const catalog: NonNullable<Parameters<typeof antigravitySnapshot>[1]> =
  JSON.parse(readFileSync("fixtures/native/provider-catalog.mock.json", "utf8"));

test("joins cached model names to exact windows and shared pools without copying quota values to members", () => {
  const { models, accounts } = antigravitySnapshot(nativeData, catalog);
  assert.equal(models?.length, 5);
  const { groups, unlisted } = antigravityGroups(accounts[0].windows, models);
  assert.deepEqual(groups.map(g => [g.name, g.shared, g.models.map(m => m.label), g.windows.length]), [
    ["Gemini Pro", false, ["Gemini Pro"], 2],
    ["Gemini Flash", false, ["Gemini Flash"], 2],
    ["Claude and GPT", true, ["Claude Sonnet 4.6", "GPT-OSS 120B"], 2],
  ]);
  assert.deepEqual(unlisted.map(m => m.label), ["Gemini 4 Argon"]);
  assert.equal(groups.at(-1)?.windows.at(-1)?.disabled, true);
});

test("keeps the reported Gemini pool once, separates the known Argon bucket, and retains unfamiliar periods", () => {
  const [report] = nativeData.providers;
  const [sample] = report.windows;
  const windows = [
    { ...sample, id: "gemini-5h", label: "Gemini · 5h" },
    { ...sample, id: "gemini-argon-wtu-weekly", label: "Gemini · Weekly" },
    { ...sample, id: "other", label: "Gamma · Beta · Burst limit" },
  ];
  const { models, accounts } = antigravitySnapshot({ providers: [{ ...report, windows }] }, catalog);
  const { groups } = antigravityGroups(accounts[0].windows, models);
  assert.deepEqual(groups.map(g => [g.name, g.models.map(m => m.label), g.windows.map(w => w.period)]), [
    ["Gemini", ["Gemini Pro", "Gemini Flash"], ["5h"]],
    ["Gemini 4 Argon", ["Gemini 4 Argon"], ["Weekly"]],
    ["Gamma · Beta", [], ["Burst limit"]],
  ]);
});

test("keeps provider catalogs separate from account data, including when usage or the catalog is missing", () => {
  const decoded = { entries: expandProviderSnapshot(catalog.compactSnapshot!) };
  assert.deepEqual(antigravitySnapshot(nativeData, decoded), antigravitySnapshot(nativeData, catalog));
  const [native, other] = decoded.entries;
  const [model] = native.models!;
  const entry = { ...native, models: [model, { ...model, provider: "codex" }, { ...model, id: "hidden", isSelectable: false }] };
  const { models, accounts } = antigravitySnapshot({ providers: [] }, { entries: [other, entry] });
  assert.deepEqual(models, [{ id: model.id, label: model.label }]);
  assert.equal(accounts.length, 0);
  assert.equal(antigravitySnapshot(nativeData, { entries: [other] }).models, undefined);
  assert.deepEqual(antigravitySnapshot(nativeData).accounts, antigravitySnapshot(nativeData, catalog).accounts);
});
