import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { UsageSourceRegistration } from "@getpaseo/plugin/server/usage";
import { registerUsage } from "../server/paseo/usage";
import { SettingsStore } from "../server/storage/store";
import { UsageService } from "../server/usage/service";

test("native global discovery reuses sidebar data and rejects superseded account bindings", async t => {
  const directory = mkdtempSync(join(tmpdir(), "native-usage-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new SettingsStore(directory);
  const draft = { label: "Pool", baseUrl: "https://cpa.example.invalid", password: "synthetic-value" };
  store.save(draft);
  store.save({ ...draft, label: "Another pool", baseUrl: "https://another.keeper.invalid" });
  store.preferences({ claude: { enabled: true, providerId: "my-custom-claude" } });
  let reads = 0;
  const usage = new UsageService(store, () => ({
    test: () => assert.fail(),
    requestRefresh: () => assert.fail("Native operations must only read Keeper"),
    read: async () => {
      reads++;
      return [{ id: "demo", label: "Account", enabled: true, state: "available", observedAt: "2026-11-26T00:00:00Z",
        windows: [{ id: "five_hour", label: "5-hour", usedPercent: 23, resetAt: null }] }];
    },
  }));
  const sources: UsageSourceRegistration[] = [];
  registerUsage({ registerUsageSource: source => sources.push(source) }, usage.sources);
  const [cpa, claude] = sources;
  assert.deepEqual(sources.map(source => source.label), ["Codex", "Claude"]);
  for (const source of sources) {
    assert.deepEqual(await source.discover({ kind: "session", provider: "claude", env: {} }), []);
  }
  assert.equal(reads, 0);
  const [account, other] = await cpa.discover({ kind: "global" });
  assert.equal(other.label, account.label);
  assert.notEqual(other.key, account.key);
  assert.doesNotMatch(JSON.stringify(account.input), /cpa\.example|synthetic-value/);
  assert.equal(account.label, "Account");
  const report = await cpa.fetch(account.input);
  assert.equal(report.status, "available");
  if (report.status === "available") assert.equal(report.windows[0].remainingPct, 77);
  await usage.overview();
  assert.equal(reads, 2);
  store.save({ ...draft, id: store.instances[0].id, password: "synthetic-replacement" });
  usage.prune();
  assert.equal((await cpa.fetch(account.input)).status, "unavailable");
  assert.equal((await cpa.fetch(other.input)).status, "available");
  const [login] = await claude.discover({ kind: "global" });
  assert.equal(login.label, undefined);
  assert.ok(!JSON.stringify(login).includes("my-custom-claude"));
  assert.ok(!JSON.stringify(await usage.overview()).includes("my-custom-claude"));
  store.preferences({ claude: { enabled: true, providerId: "different-login" } });
  assert.equal((await claude.fetch(login.input)).status, "unavailable");
});
