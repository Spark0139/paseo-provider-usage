import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createKeeperClient } from "../server/sources/keeper";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/keeper/${name}.mock.json`, import.meta.url), "utf8"));
const instance = { id: "demo", label: "Keeper", baseUrl: "https://keeper.example.invalid/base/" };
const prefix = instance.baseUrl + "api/v1";
const identities = fixture("identities");
const cache = fixture("cache");
const cookie = (value: string) => new Response(null, { status: 204, headers: {
  "Set-Cookie": `cpa_usage_keeper_session=${value}; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Max-Age=3600; Path=/base; HttpOnly; Secure`,
} });

test("read uses credential indexes and Keeper observation times, independently of the pool and refresh state", async () => {
  const first = cache.items[0].quota.quota[0];
  const sample = structuredClone(cache);
  delete sample.items[0].quota.quota[0].resetAt;
  sample.items[0].quota.quota[0].resetAfterSeconds = 60;
  sample.items[0].quota.quota.push({ key: "additional_rate_limits.feature.primary_window", scope: "additional", label: "Feature", window: { seconds: 60 } });
  sample.items[0].upstream_responses = [{ body: "synthetic-private-payload" }];
  const paths: string[] = [];
  const client = createKeeperClient(instance, "", { fetch: async (url, init) => {
    paths.push(String(url));
    assert.equal(init?.redirect, "manual");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("cookie"), null);
    if (url === prefix + "/usage/identities") return Response.json(identities);
    assert.equal(url, prefix + "/quota/cache");
    assert.equal(init?.method, "POST");
    assert.equal(headers.get("X-CPA-Usage-Keeper-Request"), "fetch");
    assert.deepEqual(JSON.parse(String(init?.body)), { auth_indexes: ["demo-pro", "demo-plus", "demo-disabled"] });
    return Response.json(sample);
  } });
  assert.equal(await client.test(), 3);
  const accounts = await client.read();
  assert.deepEqual(paths, [prefix + "/usage/identities", prefix + "/usage/identities", prefix + "/quota/cache"]);
  assert.deepEqual(accounts.map(x => [x.enabled, x.state]), [[true, "available"], [true, "exhausted"], [false, "disabled"]]);
  assert.equal(accounts[0].observedAt, "2026-11-26T05:32:00.000Z");
  assert.equal(accounts[0].windows[0].resetAt, "2026-11-26T05:33:00.000Z");
  assert.equal(accounts[0].windows[0].usedPercent, first.usedPercent);
  assert.equal(accounts[0].windows.at(-1)?.usedPercent, null);
  assert.equal(accounts[1].windows[1].status, "allowed");
  assert.equal(accounts[0].planLabel, "Pro");
  assert.equal(accounts[2].observedAt, null);
  assert.ok(!JSON.stringify(accounts).includes("synthetic-private-payload"));
});

test("login is coalesced, the session is reused and an expired cookie can reauthenticate once", async () => {
  let logins = 0;
  let revoke = false;
  const client = createKeeperClient(instance, "synthetic-password", { fetch: async (url, init) => {
    const headers = new Headers(init?.headers);
    if (url === prefix + "/auth/login") {
      assert.deepEqual(JSON.parse(String(init?.body)), { password: "synthetic-password" });
      assert.equal(headers.get("X-CPA-Usage-Keeper-Request"), "fetch");
      assert.equal(headers.get("cookie"), null);
      return cookie("fake-" + ++logins);
    }
    assert.equal(url, prefix + "/usage/identities");
    assert.equal(init?.body, undefined);
    const token = headers.get("cookie");
    if (!token || (revoke && token !== "cpa_usage_keeper_session=fake-2")) return new Response(null, { status: 401 });
    return Response.json(identities);
  } });
  assert.deepEqual(await Promise.all([client.test(), client.test()]), [3, 3]);
  assert.equal(logins, 1);
  await client.test();
  assert.equal(logins, 1);
  revoke = true;
  await Promise.all([client.test(), client.test()]);
  assert.equal(logins, 2);
});

test("a persistent 401 terminates after one sign-in attempt and redacts response bodies", async () => {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async url => {
    calls.push(String(url));
    return url === prefix + "/auth/login" ? cookie("fake") : new Response("raw-upstream-private", { status: 401 });
  };
  await assert.rejects(createKeeperClient(instance, "secret", { fetch }).test(), { message: "Keeper request failed (HTTP 401)." });
  assert.deepEqual(calls, [prefix + "/usage/identities", prefix + "/auth/login", prefix + "/usage/identities"]);
  calls.length = 0;
  await assert.rejects(createKeeperClient(instance, "", { fetch }).test(), /requires a login password/);
  assert.deepEqual(calls, [prefix + "/usage/identities"]);
});

test("manual refresh only queues current enabled Codex credentials and distinguishes duplicate and skipped", async () => {
  const paths: string[] = [];
  let refresh = fixture("refresh");
  const client = createKeeperClient(instance, "", { fetch: async (url, init) => {
    paths.push(String(url));
    if (url === prefix + "/usage/identities") return Response.json(identities);
    assert.equal(new Headers(init?.headers).get("X-CPA-Usage-Keeper-Request"), "fetch");
    assert.deepEqual(JSON.parse(String(init?.body)), { auth_indexes: ["demo-pro", "demo-plus"] });
    return Response.json(refresh);
  } });
  assert.deepEqual(await client.requestRefresh(), { queued: 1, pending: 1, failed: 0 });
  assert.deepEqual(paths, [prefix + "/usage/identities", prefix + "/quota/refresh"]);
  refresh = { limit: 2, accepted: 0, skipped: 2, tasks: null, rejected: [{ authIndex: "demo-plus", error: "not_found" }] };
  assert.deepEqual(await client.requestRefresh(), { queued: 0, pending: 0, failed: 2 });
});

test("cache failures, mismatched nested IDs and missing readings never create observations", async () => {
  const items = structuredClone(cache).items;
  items[0].quota.id = "101"; // Keeper row ID, distinct from the required credential index.
  items[1] = { ...fixture("cache-failed").items[0], auth_index: "demo-plus", error: "raw-private" };
  const fetch: typeof globalThis.fetch = async url => Response.json(url === prefix + "/usage/identities" ? identities : { items });
  const [mismatch, failed, missing] = await createKeeperClient(instance, "", { fetch }).read();
  assert.equal(mismatch.observedAt, null);
  assert.match(mismatch.error!, /Invalid Keeper/);
  assert.equal(failed.state, "unavailable");
  assert.match(failed.error!, /HTTP 401/);
  assert.equal(failed.observedAt, null);
  assert.equal(missing.windows.length, 0);
  assert.ok(!JSON.stringify(failed).includes("raw-private"));
});

test("expired failed observations and absent enablement stay unknown; empty selections cannot queue a refresh", async () => {
  const expired = { ...fixture("cache-failed").items[0], expires_at: "2000-01-01T00:00:00Z" };
  const entry = { ...identities.identities[0], disabled: null };
  const calls: string[] = [];
  const client = createKeeperClient(instance, "", { fetch: async url => {
    calls.push(String(url));
    if (url === prefix + "/usage/identities") return Response.json({ identities: [entry] });
    return Response.json({ items: [expired] });
  } });
  const [account] = await client.read();
  assert.deepEqual([account.enabled, account.state, account.observedAt, account.error], [null, "unknown", null, undefined]);
  assert.deepEqual(await client.requestRefresh(), { queued: 0, pending: 0, failed: 0 });
  assert.ok(!calls.some(url => url.endsWith("/refresh")));
});

test("duration pins and relative resets follow the same Keeper window when the roles change", async () => {
  const sample = structuredClone(cache);
  const client = createKeeperClient(instance, "", { fetch: async url =>
    Response.json(url === prefix + "/usage/identities" ? identities : sample) });
  const before = (await client.read())[0];
  const [primary, weekly] = sample.items[0].quota.quota;
  primary.key = "rate_limit.secondary_window";
  weekly.key = "rate_limit.primary_window";
  sample.items[0].quota.quota = [weekly, primary];
  const after = (await client.read())[0];
  assert.deepEqual(after.windows, [...before.windows].reverse());
});

test("renaming a Keeper credential preserves its native report locator", async () => {
  const entry = structuredClone(identities.identities[0]);
  const client = createKeeperClient(instance, "", { fetch: async url => Response.json(
    url === prefix + "/usage/identities" ? { identities: [entry] } : cache,
  ) });
  const [before] = await client.read();
  entry.name = "Updated credential name";
  entry.displayName = "Updated alias";
  const [after] = await client.read();
  assert.equal(after.label, "Updated alias");
  assert.equal(after.id, before.id);
  entry.id = "999";
  assert.notEqual((await client.read())[0].id, before.id);
});
