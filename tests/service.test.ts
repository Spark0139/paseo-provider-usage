import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { SettingsStore } from "../server/storage/store";
import { UsageService } from "../server/usage/service";
import type { Account } from "../shared/types";

function settings(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "quota-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return new SettingsStore(directory);
}

const draft = { label: "Personal", baseUrl: "https://personal.example.invalid", key: "synthetic-management-value" };
const observedAt = "2026-11-26T05:32:00.000Z";
const reading: Account = {
  id: "account-1", label: "Personal Pro", enabled: true, state: "available", observedAt,
  windows: [{ id: "five_hour", label: "5-hour", usedPercent: 18, resetAt: null }],
};

test("configuration never echoes a key, binds reuse to origin, and persists owner-only files", t => {
  const store = settings(t);
  store.save(draft);
  const [{ id }] = store.instances;
  assert.throws(() => store.resolve({ ...draft, baseUrl: "https://elsewhere.invalid", id, key: "" }));
  assert.throws(() => store.resolve({ ...draft, baseUrl: "https://example.invalid/?key=value" }));
  assert.equal(store.resolve({ ...draft, id, key: "" }).key, draft.key);
  assert.equal(store.view(null).instances[0].hasSecret, true);
  assert.ok(!JSON.stringify(store.view(null)).includes(draft.key));
  assert.ok(!readFileSync(join(store.directory, "config.json"), "utf8").includes(draft.key));
  assert.equal(statSync(join(store.directory, "secrets.json")).mode & 0o777, 0o600);
  const restarted = new SettingsStore(store.directory);
  assert.equal(restarted.key(restarted.instances[0]), draft.key);
  restarted.save({ ...draft, id, key: "synthetic-replacement" });
  assert.ok(!readFileSync(join(store.directory, "secrets.json"), "utf8").includes(draft.key));
  restarted.remove(id, true);
  assert.equal(restarted.view(null).instances[0].hasSecret, false);
  assert.deepEqual(JSON.parse(readFileSync(join(store.directory, "secrets.json"), "utf8")), {});
  restarted.remove(id);
  assert.equal(restarted.instances.length, 0);
});

test("simultaneous native and sidebar reads share refresh, retain last observation on errors and restart", async t => {
  const store = settings(t);
  store.save(draft);
  store.save({ ...draft, label: "Unavailable", baseUrl: "https://second.example.invalid" });
  let time = Date.parse(observedAt);
  let calls = 0;
  let accountError = false;
  const service = new UsageService(store, async instance => {
    calls++;
    if (instance.label === "Unavailable") throw new Error("CPA returned HTTP 403.");
    return accountError ? [{ ...reading, state: "unavailable", windows: [], observedAt: null, error: "HTTP 401" }] : [reading];
  }, () => new Date(time));
  const [first] = await Promise.all([service.overview(), service.cpaSnapshot(store.instances[0])]);
  assert.equal(calls, 2);
  assert.equal(first[1].accounts.length, 0);
  assert.equal(first[1].lastSuccessAt, null);
  assert.match(first[1].error!, /403/);
  time += 59_000;
  await service.overview(true);
  assert.equal(calls, 2);
  time += 2_000;
  accountError = true;
  const [second] = await service.overview(true);
  assert.deepEqual(second.accounts[0], { ...reading, state: "unavailable", error: "HTTP 401" });
  assert.equal(second.lastSuccessAt, observedAt);
  const restarted = new UsageService(new SettingsStore(store.directory), async () => assert.fail("unexpected fetch"), () => new Date(time));
  assert.deepEqual((await restarted.overview())[0], second);
});

test("editing a CPA binding while a refresh is in flight discards the obsolete observation", async t => {
  const store = settings(t);
  store.save(draft);
  let finish!: (accounts: Account[]) => void;
  const service = new UsageService(store, () => new Promise(resolve => { finish = resolve; }));
  const pending = service.overview();
  store.save({ ...draft, id: store.instances[0].id, baseUrl: "https://new.example.invalid", key: "synthetic-new" });
  service.prune();
  finish([reading]);
  assert.deepEqual(await pending, []);
  const restarted = new UsageService(store, async () => []);
  assert.deepEqual((await restarted.overview())[0].accounts, []);
});

test("partial Claude events preserve independent windows, survive restart and respect identity changes", t => {
  const store = settings(t);
  store.preferences({ claude: { enabled: true, providerId: "claude" } });
  const service = new UsageService(store, async () => assert.fail());
  service.ingest(reading.windows, observedAt);
  const second = { ...reading.windows[0], id: "seven_day", label: "Weekly", usedPercent: 61 };
  service.ingest([second], observedAt);
  service.ingest([], "2026-11-27T05:32:00.000Z");
  service.ingest([{ ...second, usedPercent: 2 }], "2026-11-25T05:32:00.000Z");
  const restarted = new UsageService(new SettingsStore(store.directory), async () => []);
  assert.deepEqual(restarted.claudeSnapshot().accounts[0].windows.map(w => w.usedPercent), [18, 61]);
  assert.equal(restarted.claudeSnapshot().lastSuccessAt, observedAt);
  store.preferences({ claude: { enabled: true, providerId: "other-login" } });
  service.prune();
  assert.equal(service.claudeSnapshot().lastSuccessAt, null);
});
