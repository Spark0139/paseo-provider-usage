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

test("an existing configuration preserves its passwords and settings when saving a composer account", t => {
  const store = settings(t);
  store.save(draft);
  store.preferences({ claude: { enabled: true, providerId: "demo-claude" }, display: { showDisabledAccounts: false } });
  const path = join(store.directory, "config-v2.json");
  const prior = JSON.parse(readFileSync(path, "utf8"));
  delete prior.codexAccount;
  writeFileSync(path, JSON.stringify(prior));
  const upgraded = new SettingsStore(store.directory);
  assert.equal(upgraded.codexAccount, null);
  const baseline = upgraded.view(null);
  const preferred = { sourceId: upgraded.instances[0].id, accountId: "synthetic-account-id" };
  upgraded.preferences({ codexAccount: preferred });
  const reloaded = new SettingsStore(store.directory);
  assert.deepEqual(reloaded.view(null), { ...baseline, codexAccount: preferred });
  assert.equal(reloaded.password(reloaded.instances[0]), draft.password);
  reloaded.preferences({ display: { showResetCountdown: false } });
  assert.deepEqual(reloaded.codexAccount, preferred);
  reloaded.preferences({ codexAccount: null });
  assert.equal(new SettingsStore(store.directory).codexAccount, null);
});

test("overviews share reads, bypass local TTL on demand and retain actual observation times on errors", async t => {
  const store = settings(t);
  store.save(draft);
  store.save({ ...draft, label: "Unavailable", baseUrl: "https://second.example.invalid" });
  let time = Date.parse(observedAt);
  let calls = 0;
  let accountError = false;
  const service = new UsageService(store, instance => ({
    test: noRefresh, taskStatus: noRefresh, requestRefresh: noRefresh,
    read: async () => {
      calls++;
      if (instance.label === "Unavailable") throw new Error("Keeper returned HTTP 403.");
      return accountError ? [{ ...reading, state: "unavailable", windows: [], observedAt: null, error: "HTTP 401" }] : [reading];
    },
  }), () => new Date(time));
  const [first] = await Promise.all([service.overview(), service.keeper.snapshot(store.instances[0])]);
  assert.equal(calls, 2);
  assert.deepEqual(first.map(source => [source.label, source.instanceLabel]), [["Codex", "Personal"], ["Codex", "Unavailable"]]);
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
    return { test: async () => 2, read: async () => [reading], taskStatus: noRefresh, requestRefresh: noRefresh };
  });
  assert.equal(await service.keeper.testInstance({ ...draft, id, password: "" }), 2);
  await service.overview();
  await service.keeper.testInstance({ ...draft, id, label: "renamed", baseUrl: draft.baseUrl + "/" });
  assert.equal(sessions.length, 1);
  await service.keeper.testInstance({ ...draft, id, password: "replacement" });
  await service.keeper.testInstance({ ...draft, id, baseUrl: draft.baseUrl + "/other", password: "" });
  await service.keeper.testInstance({ ...draft, password: "" });
  assert.deepEqual(sessions.map(s => [s.url, s.password]), [
    [draft.baseUrl, draft.password], [draft.baseUrl, "replacement"],
    [draft.baseUrl + "/other", ""], [draft.baseUrl, ""],
  ]);
  assert.equal(new Set(sessions.map(s => s.signal)).size, 4);
  await service.keeper.testInstance({ ...draft, id });
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
      taskStatus: noRefresh,
      requestRefresh: () => {
        refreshes++;
        return new Promise(resolve => { finishRefresh = () => resolve({ queued: 1, pending: 0, failed: 0, indexes: ["demo"] }); });
      },
    };
  });
  const pending = service.overview();
  const refresh = service.keeper.requestRefresh(id);
  assert.equal(service.keeper.requestRefresh(id), refresh);
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
  service.keeper.dispose();
  assert.equal(signals[1].aborted, true);
});

test("partial Claude events survive restart and respect identity changes", t => {
  const store = settings(t);
  store.preferences({ claude: { enabled: true, providerId: "claude" } });
  const service = new UsageService(store, () => assert.fail());
  service.claude.ingest(reading.windows, observedAt);
  const second = { ...reading.windows[0], id: "seven_day", label: "Weekly", usedPercent: 61 };
  service.claude.ingest([second], observedAt);
  service.claude.ingest([], "2026-11-27T05:32:00.000Z");
  service.claude.ingest([{ ...second, usedPercent: 2 }], "2026-11-25T05:32:00.000Z");
  const restarted = new UsageService(new SettingsStore(store.directory), () => assert.fail());
  assert.deepEqual(restarted.claude.snapshot().accounts[0].windows.map(w => w.usedPercent), [18, 61]);
  assert.equal(restarted.claude.snapshot().lastSuccessAt, observedAt);

  const fable = { id: "seven_day_overage_included", label: "Fable 周额度", usedPercent: 100,
    resetAt: "2026-12-02T15:00:00.000Z", status: "rejected" };
  restarted.claude.ingest([fable], observedAt);
  restarted.claude.ingest([{ ...fable, usedPercent: null }], observedAt);
  const account = restarted.claude.snapshot().accounts[0];
  assert.deepEqual(account.windows, [reading.windows[0], second, fable]);
  assert.equal(account.state, "available");
  const renewed = { ...fable, usedPercent: null, status: "allowed", resetAt: "2026-12-09T15:00:00.000Z" };
  restarted.claude.ingest([renewed], "2026-12-02T15:01:00.000Z");
  const saved = new UsageService(new SettingsStore(store.directory), () => assert.fail());
  assert.deepEqual(saved.claude.snapshot().accounts[0].windows, [reading.windows[0], second, renewed]);

  store.preferences({ claude: { enabled: true, providerId: "other-login" } });
  service.prune();
  assert.equal(service.claude.snapshot().lastSuccessAt, null);
  service.claude.ingest([fable], observedAt);
  assert.equal(service.claude.snapshot().accounts[0].state, "unknown");
  service.claude.ingest([{ ...second, usedPercent: 100 }], observedAt);
  assert.equal(service.claude.snapshot().accounts[0].state, "exhausted");
});

test("one explicit submission follows new and existing work, then refreshes only that instance's cache", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(observedAt) });
  const store = settings(t);
  store.save(draft);
  store.save({ ...draft, baseUrl: "https://second.example.invalid", label: "Second" });
  const [instance, other] = store.instances;
  let submitted = 0;
  let checked = 0;
  let version = 1;
  const reads: string[] = [];
  const service = new UsageService(store, ({ id }) => ({
    test: () => assert.fail(),
    async read() {
      reads.push(id);
      return [{ ...reading, windows: [{ ...reading.windows[0], usedPercent: version }] }];
    },
    async requestRefresh() {
      submitted++;
      return { queued: 1, pending: 1, failed: 1, indexes: ["new", "existing"] };
    },
    async taskStatus(index) {
      checked++;
      return checked === 1 ? "running" : index === "new" ? "completed" : "failed";
    },
  }));
  await service.overview();
  assert.deepEqual(service.keeper.refreshStatus(instance.id), { phase: "idle", completed: 0, failed: 0, remaining: 0 });
  const receipt = { queued: 1, pending: 1, failed: 1 };
  assert.deepEqual(await service.keeper.requestRefresh(instance.id), receipt);
  assert.deepEqual(await service.keeper.requestRefresh(instance.id), receipt);
  assert.equal(service.keeper.refreshStatus(instance.id).phase, "pending");
  assert.equal(service.keeper.refreshStatus(instance.id).phase, "pending");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(service.keeper.refreshStatus(instance.id), { phase: "pending", completed: 0, failed: 2, remaining: 1 });
  assert.equal(checked, 2);
  t.mock.timers.tick(4_000);
  assert.equal(checked, 2); // No observer, no timer or Keeper traffic.
  version = 2;
  service.keeper.refreshStatus(instance.id);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(service.keeper.refreshStatus(instance.id), { phase: "completed", completed: 1, failed: 2, remaining: 0 });
  assert.equal(submitted, 1);
  assert.equal(checked, 3);
  const [first, second] = await service.overview();
  assert.equal(first.accounts[0].windows[0].usedPercent, 2);
  assert.equal(second.accounts[0].windows[0].usedPercent, 1);
  assert.deepEqual(reads, [instance.id, other.id, instance.id]);
});

test("task checks back off, distinguish a lost task from failure and preserve the last successful reading", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(observedAt) });
  const store = settings(t);
  store.save(draft);
  const [{ id }] = store.instances;
  let checks = 0;
  const service = new UsageService(store, () => ({
    test: noRefresh,
    async requestRefresh() { return { queued: 1, pending: 0, failed: 0, indexes: ["one"] }; },
    async taskStatus() {
      if (!checks++) throw new Error("Keeper 请求失败（HTTP 503）。");
      return "missing";
    },
    async read() { return [checks ? { ...reading, windows: [], observedAt: null } : reading]; },
  }));
  await service.overview();
  await service.keeper.requestRefresh(id);
  service.keeper.refreshStatus(id);
  await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(4_000);
  const pending = service.keeper.refreshStatus(id);
  assert.equal(pending.phase, "pending");
  assert.match(pending.error!, /503/);
  assert.equal(checks, 1);
  t.mock.timers.tick(8_000);
  service.keeper.refreshStatus(id);
  await new Promise<void>(resolve => setImmediate(resolve));
  const end = service.keeper.refreshStatus(id);
  assert.deepEqual([end.phase, end.remaining, end.failed], ["unconfirmed", 1, 0]);
  const [snapshot] = await service.overview();
  assert.deepEqual(snapshot.accounts[0].windows, reading.windows);
  assert.equal(snapshot.accounts[0].observedAt, observedAt);
});

test("checks at most four waiting tasks per pass, rotates fairly and stops when the observation period expires", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(observedAt) });
  const store = settings(t);
  store.save(draft);
  const [{ id }] = store.instances;
  const indexes = Array.from({ length: 6 }, (_, i) => String(i + 1));
  const checked: string[] = [];
  const service = new UsageService(store, () => ({
    read: async () => [], test: noRefresh,
    async requestRefresh() { return { queued: 6, pending: 0, failed: 0, indexes }; },
    async taskStatus(index) { checked.push(index); return "queued"; },
  }));
  await service.keeper.requestRefresh(id);
  service.keeper.refreshStatus(id);
  assert.deepEqual(checked, ["1", "2", "3", "4"]);
  await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(4_000);
  service.keeper.refreshStatus(id);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(checked.slice(4), ["5", "6", "1", "2"]);
  t.mock.timers.tick(20 * 60_000);
  service.keeper.refreshStatus(id);
  await new Promise<void>(resolve => setImmediate(resolve));
  const final = service.keeper.refreshStatus(id);
  assert.deepEqual([final.phase, final.remaining, checked.length], ["unconfirmed", 6, 8]);
});
