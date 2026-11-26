import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

const draft = { label: "Personal", baseUrl: "https://personal.example.invalid/team", password: "synthetic-password" };
const observedAt = "2026-11-26T05:32:00.000Z";
const reading: Account = {
  id: "account-1", label: "Personal Pro", enabled: true, state: "available", observedAt,
  windows: [{ id: "five_hour", label: "5-hour", usedPercent: 18, resetAt: null }],
};
const noRefresh = () => assert.fail("Reading quota must not trigger a Keeper refresh");

test("old installations retain Claude preferences and readings without reusing CPA secrets or account data", async t => {
  const { directory } = settings(t);
  const claude = { enabled: true, providerId: "custom-claude" };
  const display = { showDisabledAccounts: false, showNativeProviders: false, showResetCountdown: true };
  writeFileSync(join(directory, "config.json"), JSON.stringify({ claude, display, instances: [
    { id: "old-cpa", label: "Old CPA", baseUrl: draft.baseUrl, secretRef: "old-ref" },
  ] }));
  const oldSecrets = '{"old-ref":"synthetic-cpa-admin-key"}';
  writeFileSync(join(directory, "secrets.json"), oldSecrets);
  const snapshot = {
    sourceId: "claude-passive", label: "Claude", kind: "claude", accounts: [reading],
    lastAttemptAt: observedAt, lastSuccessAt: observedAt,
  };
  writeFileSync(join(directory, "snapshot.json"), JSON.stringify({
    "claude-passive": { identity: claude.providerId, snapshot },
    "old-cpa": { identity: "old-ref", snapshot: { ...snapshot, kind: "cpa", sourceId: "old-cpa" } },
  }));
  const store = new SettingsStore(directory);
  assert.deepEqual(store.view(observedAt), { claude, display, claudeObservedAt: observedAt, instances: [] });
  assert.throws(() => store.resolve({ ...draft, id: "old-cpa", password: "" }), /移除/);
  const supplied: string[] = [];
  const service = new UsageService(store, (_instance, password) => {
    supplied.push(password);
    return { test: noRefresh, read: async () => [], requestRefresh: noRefresh };
  });
  assert.deepEqual(await service.overview(), [snapshot]);
  store.save({ ...draft, password: "" });
  await service.overview();
  assert.deepEqual(supplied, [""]);
  assert.equal(readFileSync(join(directory, "secrets.json"), "utf8"), oldSecrets);
});

test("password reuse is limited to the same normalized Keeper URL, supports explicit clearing, and stays private", t => {
  const store = settings(t);
  store.save(draft);
  const [{ id, binding }] = store.instances;
  assert.throws(() => store.resolve({ ...draft, baseUrl: "https://example.invalid/?token=value" }));
  assert.equal(store.resolve({ ...draft, id, baseUrl: draft.baseUrl + "/", password: "" }).password, draft.password);
  assert.equal(store.resolve({ ...draft, id, baseUrl: draft.baseUrl + "/different", password: "" }).password, "");
  assert.equal(store.view(null).instances[0].hasPassword, true);
  assert.ok(!JSON.stringify(store.view(null)).includes(draft.password));
  assert.ok(!readFileSync(join(store.directory, "config-v2.json"), "utf8").includes(draft.password));
  assert.equal(statSync(join(store.directory, "keeper-passwords.json")).mode & 0o777, 0o600);
  const restarted = new SettingsStore(store.directory);
  restarted.save({ ...draft, id, label: "Renamed", password: "" });
  assert.equal(restarted.instances[0].binding, binding);
  assert.equal(restarted.password(restarted.instances[0]), draft.password);
  restarted.clearPassword(id);
  assert.equal(restarted.view(null).instances[0].hasPassword, false);
  assert.notEqual(restarted.instances[0].binding, binding);
  assert.deepEqual(JSON.parse(readFileSync(join(store.directory, "keeper-passwords.json"), "utf8")), {});
  assert.equal(restarted.resolve({ ...draft, id, password: "" }).password, "");
  restarted.remove(id);
  assert.equal(restarted.instances.length, 0);
});

test("overviews share reads, bypass local TTL on demand and retain actual observation times on errors", async t => {
  const store = settings(t);
  store.save(draft);
  store.save({ ...draft, label: "Unavailable", baseUrl: "https://second.example.invalid" });
  let time = Date.parse(observedAt);
  let calls = 0;
  let accountError = false;
  const service = new UsageService(store, instance => ({
    test: noRefresh, requestRefresh: noRefresh,
    read: async () => {
      calls++;
      if (instance.label === "Unavailable") throw new Error("Keeper returned HTTP 403.");
      return accountError ? [{ ...reading, state: "unavailable", windows: [], observedAt: null, error: "HTTP 401" }] : [reading];
    },
  }), () => new Date(time));
  const [first] = await Promise.all([service.overview(), service.keeperSnapshot(store.instances[0])]);
  assert.equal(calls, 2);
  assert.equal(first[1].accounts.length, 0);
  assert.equal(first[1].lastSuccessAt, null);
  assert.match(first[1].error!, /403/);
  time += 1_000;
  await service.overview();
  assert.equal(calls, 2);
  accountError = true;
  const [second] = await service.overview(true);
  assert.equal(calls, 4);
  assert.deepEqual(second.accounts[0], { ...reading, state: "unavailable", error: "HTTP 401" });
  assert.equal(second.lastSuccessAt, observedAt);
  const restarted = new UsageService(new SettingsStore(store.directory), () => assert.fail("unexpected fetch"), () => new Date(time));
  assert.deepEqual((await restarted.overview())[0], second);
});

test("connection tests reuse a saved session and isolate edited or unsaved drafts", async t => {
  const store = settings(t);
  store.save(draft);
  const { id } = store.instances[0];
  const sessions: { url: string; password: string; signal: AbortSignal }[] = [];
  const service = new UsageService(store, (instance, password, signal) => {
    sessions.push({ url: instance.baseUrl, password, signal });
    return { test: async () => 2, read: async () => [reading], requestRefresh: noRefresh };
  });
  assert.equal(await service.testInstance({ ...draft, id, password: "" }), 2);
  await service.overview();
  await service.testInstance({ ...draft, id, label: "renamed", baseUrl: draft.baseUrl + "/" });
  assert.equal(sessions.length, 1);
  await service.testInstance({ ...draft, id, password: "replacement" });
  await service.testInstance({ ...draft, id, baseUrl: draft.baseUrl + "/other", password: "" });
  await service.testInstance({ ...draft, password: "" });
  assert.deepEqual(sessions.map(s => [s.url, s.password]), [
    [draft.baseUrl, draft.password], [draft.baseUrl, "replacement"],
    [draft.baseUrl + "/other", ""], [draft.baseUrl, ""],
  ]);
  assert.equal(new Set(sessions.map(s => s.signal)).size, 4);
  await service.testInstance({ ...draft, id });
  assert.equal(sessions.length, 4);
  assert.equal(store.password(store.instances[0]), draft.password);
});

test("concurrent refresh requests join and replaced bindings discard late reads, refresh results and sessions", async t => {
  const store = settings(t);
  store.save(draft);
  const { id } = store.instances[0];
  let finishRead!: (accounts: Account[]) => void;
  let finishRefresh!: () => void;
  let refreshes = 0;
  const signals: AbortSignal[] = [];
  const service = new UsageService(store, (_instance, _password, signal) => {
    signals.push(signal);
    return {
      test: noRefresh,
      read: () => new Promise(resolve => { finishRead = resolve; }),
      requestRefresh: () => {
        refreshes++;
        return new Promise(resolve => { finishRefresh = () => resolve({ queued: 1, pending: 0, failed: 0 }); });
      },
    };
  });
  const pending = service.overview();
  const refresh = service.requestRefresh(id);
  assert.equal(service.requestRefresh(id), refresh);
  assert.equal(refreshes, 1);
  assert.equal(signals.length, 1);
  store.save({ ...draft, id, baseUrl: draft.baseUrl + "/other" });
  service.prune();
  store.save({ ...draft, id }); // returning to the old address must create a fresh binding
  service.prune();
  assert.equal(signals[0].aborted, true);
  finishRead([reading]);
  finishRefresh();
  assert.deepEqual(await pending, []);
  await assert.rejects(refresh, /设置已变更/);
  const next = service.overview();
  assert.equal(signals.length, 2);
  finishRead([]);
  assert.deepEqual((await next)[0].accounts, []);
  service.dispose();
  assert.equal(signals[1].aborted, true);
});

test("partial Claude events survive restart and respect identity changes", t => {
  const store = settings(t);
  store.preferences({ claude: { enabled: true, providerId: "claude" } });
  const service = new UsageService(store, () => assert.fail());
  service.ingest(reading.windows, observedAt);
  const second = { ...reading.windows[0], id: "seven_day", label: "Weekly", usedPercent: 61 };
  service.ingest([second], observedAt);
  service.ingest([], "2026-11-27T05:32:00.000Z");
  service.ingest([{ ...second, usedPercent: 2 }], "2026-11-25T05:32:00.000Z");
  const restarted = new UsageService(new SettingsStore(store.directory), () => assert.fail());
  assert.deepEqual(restarted.claudeSnapshot().accounts[0].windows.map(w => w.usedPercent), [18, 61]);
  assert.equal(restarted.claudeSnapshot().lastSuccessAt, observedAt);
  store.preferences({ claude: { enabled: true, providerId: "other-login" } });
  service.prune();
  assert.equal(service.claudeSnapshot().lastSuccessAt, null);
});
