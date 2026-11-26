import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pullCpa, testCpa } from "../server/sources/cpa";
import { enabledCount } from "../shared/types";

const data = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/cpa/v8/${name}.mock.json`, import.meta.url), "utf8"));
const instance = { id: "demo", label: "Pool", baseUrl: "https://cpa.example.invalid/prefix/" };
const base = instance.baseUrl + "v8/management";
const now = () => new Date("2026-11-26T05:32:00Z");
const key = "synthetic-management-key";
const list = data("credentials");
const available = data("api-call.available");
const exhausted = data("api-call.exhausted");

test("discovery lists only Codex OAuth credentials in one GET, including disabled accounts", async () => {
  let calls = 0;
  const count = await testCpa(instance, key, { fetch: async (url, init) => {
    calls++;
    assert.equal(url, base + "/credentials");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer " + key);
    assert.equal(init?.redirect, "error");
    return Response.json(list);
  } });
  assert.equal(calls, 1);
  assert.equal(count, 3);
});

test("CPA forwards one fixed read per enabled account and preserves independent windows", async () => {
  const calls: object[] = [];
  const accounts = await pullCpa(instance, key, { now, fetch: async (url, init) => {
    if (url === base + "/credentials") return Response.json(list);
    assert.equal(url, base + "/requests/api-call");
    assert.equal(init?.method, "POST");
    const request = JSON.parse(String(init?.body));
    calls.push(request);
    return Response.json(request.auth_index === "mock-idx-01" ? available : exhausted);
  } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], data("api-call.request"));
  assert.ok(!JSON.stringify(calls).includes(key));
  assert.equal(accounts.length, 3);
  assert.equal(enabledCount(accounts), 2);
  const [pro, plus, disabled] = accounts;
  assert.equal(pro.observedAt, now().toISOString());
  assert.equal(pro.planLabel, "pro");
  assert.equal(plus.state, "exhausted");
  assert.deepEqual(plus.windows.map(w => [w.id, w.usedPercent, w.status]),
    [["five_hour", 100, "exhausted"], ["seven_day", 27, "allowed"]]);
  assert.notEqual(plus.windows[0].resetAt, pro.windows[0].resetAt);
  assert.equal(disabled.state, "disabled");
  assert.equal(disabled.observedAt, null);
  assert.ok(!JSON.stringify(accounts).includes("synthetic-value-never-display"));
});

test("a rejected account and missing percentages do not alter the sibling quota", async () => {
  const payload = { rate_limit: { limit_reached: true,
    primary_window: { reset_after_seconds: 123, limit_window_seconds: 604800 },
    secondary_window: { limit_window_seconds: 18000, used_percent: 12 },
  } };
  const accounts = await pullCpa(instance, key, { now, fetch: async (_url, init) => {
    if (init?.method === "GET") return Response.json(list);
    const isRejected = JSON.parse(String(init?.body)).auth_index === "mock-idx-02";
    return Response.json(isRejected ? data("api-call.rejected") : { status_code: 200, body: JSON.stringify(payload) });
  } });
  assert.equal(accounts[0].state, "exhausted");
  assert.deepEqual(accounts[0].windows.map(w => [w.id, w.usedPercent, w.resetAt]),
    [["seven_day", null, "2026-11-26T05:34:03.000Z"], ["five_hour", 12, null]]);
  assert.deepEqual([accounts[1].state, accounts[1].enabled, accounts[1].observedAt], ["unavailable", true, null]);
  assert.match(accounts[1].error!, /HTTP 401/);
  assert.ok(!accounts[1].error?.includes("Synthetic upstream rejection"));
});

test("failed discovery has a safe instance-level error and performs no forwarded calls", async () => {
  await assert.rejects(testCpa(instance, key, { fetch: async () => new Response(key, { status: 403 }) }),
    { message: "CPA management request failed (HTTP 403)." });
  await assert.rejects(testCpa(instance, key, { fetch: async () => Response.json({ files: [{ type: "codex", name: "account.json" }] }) }),
    /credential types/);
});
