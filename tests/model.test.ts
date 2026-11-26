import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { codexAccounts, codexPeriod, displayedCodexAccount } from "../client/codex-account";
import { accountFromCache, cacheItems, codexIdentities } from "../server/sources/keeper-quota";
import type { SourceSnapshot } from "../shared/types";
import { enabledCount, snapshotSchema } from "../shared/types";

test("pool membership includes exhausted accounts and keeps instances separate", () => {
  const sample = JSON.parse(readFileSync("fixtures/normalized/overview.mock.json", "utf8"));
  const sources = snapshotSchema.array().parse(sample.snapshots);
  assert.deepEqual(sources.slice(0, 2).map(source => [enabledCount(source.accounts), source.accounts.length]), [[2, 3], [1, 1]]);
});

test("a pinned Codex account follows its Keeper instance and reads only normal subscription windows", () => {
  const fixture = (name: string) => JSON.parse(readFileSync(`fixtures/keeper/${name}.mock.json`, "utf8"));
  const cache = cacheItems(fixture("cache"));
  const accounts = codexIdentities(fixture("identities")).map(i => accountFromCache(i, cache.get(i.identity)));
  const personal: SourceSnapshot = { kind: "cpa", sourceId: "a", label: "Codex", instanceLabel: "Personal", accounts,
    lastAttemptAt: null, lastSuccessAt: null };
  const [work, backup, disabled] = accounts;
  const [five, weekly] = work.windows;
  const secondary = { ...personal, sourceId: "b", instanceLabel: "Second", accounts: [work] };
  const list = (sources: SourceSnapshot[], preferred: { sourceId: string; accountId: string } | null = null) =>
    displayedCodexAccount(codexAccounts(sources), preferred);
  const pinned = { sourceId: "a", accountId: work.id };
  assert.deepEqual(list([secondary, personal])?.ref, pinned);
  assert.deepEqual(list([{ ...personal, accounts: [disabled, backup, work] }, secondary])?.ref, pinned);
  assert.equal(list([personal, secondary], { sourceId: "b", accountId: work.id })?.label, "Second · 工作账号");
  assert.equal(list([personal], { sourceId: "a", accountId: backup.id })?.window?.usedPercent, 100);
  assert.equal(list([secondary], pinned), undefined);
  assert.equal(list([personal], { sourceId: "a", accountId: disabled.id })?.window, undefined);
  assert.equal(list([{ ...personal, error: "Keeper read failed" }], pinned)?.window, undefined);
  const review = { ...five, id: "code_review/code_review_rate_limit/18000s" };
  const additional = { ...weekly, id: "additional/Codex-Spark/604800s" };
  const withWindows = (windows: typeof work.windows) => list([{ ...personal, accounts: [{ ...work, windows }] }], pinned)?.window;
  assert.deepEqual(withWindows([additional, weekly, review, five]), five);
  assert.equal(codexPeriod(five), "5h");
  assert.deepEqual(withWindows([review, additional, { ...five, usedPercent: null }, weekly]), weekly);
  assert.equal(codexPeriod(weekly), "7天");
  const custom = { ...weekly, id: "window/rate_limit/86400s", durationSeconds: 86_400, label: "Primary" };
  assert.equal(codexPeriod(withWindows([additional, custom])!), "1天");
  assert.equal(withWindows([review, additional]), undefined);
  const unknownDuration = { ...five, id: "rate_limit.secondary_window", durationSeconds: undefined, label: "Secondary" };
  assert.equal(codexPeriod(withWindows([review, unknownDuration])!), "次窗口");
  const unavailable = { ...work, state: "unavailable" as const, error: "HTTP 401" };
  assert.equal(list([{ ...personal, accounts: [unavailable] }], pinned)?.window, undefined);
  assert.equal(list([{ ...personal, accounts: [disabled, unavailable, backup] }])?.account.id, backup.id);
});
