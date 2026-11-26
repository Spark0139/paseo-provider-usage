import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { closeSync, openSync } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createHostClient } from "@getpaseo/client/node";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv.find((arg, i) => i > 1 && arg !== "--ui") ?? join(here, ".."));
const ui = process.argv.includes("--ui");
const id = "paseo-provider-usage";
const demoId = "provider-usage-demo";

async function program(name) {
  for (const dir of process.env.PATH.split(delimiter)) {
    const file = join(dir, name);
    if (await access(file).then(() => true, () => false)) return resolve(file);
  }
  throw new Error(`${name} is required on PATH.`);
}

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function verify(client, demo, directory) {
  const rpc = (method, input = {}) => client.invokePluginRpc(demo, method, input);
  const counts = async () => JSON.parse(await readFile(join(directory, "mock-requests.json"), "utf8"));
  const settings = await rpc("config.read");
  assert.equal(settings.instances.length, 2);
  assert.deepEqual(settings.instances.map(i => i.hasPassword), [true, false]);
  assert.ok(!JSON.stringify(settings).includes("synthetic-demo-password"));
  assert.ok(!JSON.stringify(settings).includes("demo-session"));
  const overview = await rpc("usage.overview");
  assert.equal(overview.mock, true);
  const initial = await counts();
  assert.equal(initial.refresh, 0);
  assert.ok(initial.cache >= 2);
  const personal = overview.sources.find(s => s.instanceLabel === "Personal Keeper");
  assert.equal(personal.label, "Codex");
  assert.deepEqual([personal.accounts.filter(a => a.enabled).length, personal.accounts.length], [2, 3]);
  assert.equal(personal.lastAttemptAt, "2026-11-26T07:00:00.000Z");
  assert.equal(Date.parse(personal.lastSuccessAt), Date.parse("2026-11-26T05:32:00Z"));
  assert.deepEqual(personal.accounts.map(a => a.label).sort(), ["停用账号", "备用账号", "工作账号"]);
  assert.equal(Date.parse(personal.accounts.find(a => a.label === "工作账号").observedAt), Date.parse(personal.lastSuccessAt));
  assert.equal(overview.sources.find(s => s.instanceLabel === "Second Keeper").accounts[0].state, "unavailable");
  const claudeSource = overview.sources.find(s => s.kind === "claude");
  assert.equal(claudeSource.label, "Claude");
  assert.ok(!claudeSource.accounts.some(account => account.label.includes("demo-reclaude")));
  assert.deepEqual(claudeSource.accounts[0].windows.map(w => 100 - w.usedPercent), [77, 39, 63]);
  const nativeSource = overview.sources.find(s => s.kind === "native");
  assert.equal(nativeSource.label, "Antigravity");
  assert.ok(nativeSource.models.some(model => model.label.includes("Argon")));
  const native = nativeSource.accounts[0];
  assert.deepEqual(native.windows.map(w => w.usedPercent), [25, 50, 0, 100, 75, null]);
  assert.equal(new Set(native.windows.map(w => w.id)).size, native.windows.length);

  await rpc("usage.overview", { refresh: true });
  const reread = await counts();
  assert.ok(reread.cache > initial.cache);
  assert.equal(reread.refresh, 0);

  const draft = { label: "Temporary pool", baseUrl: "https://personal.keeper.invalid", password: "synthetic-demo-password" };
  assert.deepEqual(await rpc("keeper.test", draft), { count: 3 });
  await assert.rejects(rpc("keeper.test", { ...draft, password: "synthetic-incorrect-password" }), /401/);
  assert.deepEqual(await rpc("keeper.test", { label: "Open", baseUrl: "https://second.keeper.invalid" }), { count: 1 });
  const saved = await rpc("keeper.save", draft);
  const temporary = saved.instances.find(i => i.label === draft.label);
  assert.ok(temporary?.hasPassword);
  const renamed = await rpc("keeper.save", { id: temporary.id, baseUrl: temporary.baseUrl, label: "Renamed" });
  assert.ok(renamed.instances.find(i => i.id === temporary.id).hasPassword);
  const cleared = await rpc("keeper.clear-password", { id: temporary.id });
  assert.equal(cleared.instances.find(i => i.id === temporary.id).hasPassword, false);
  await rpc("keeper.delete", { id: temporary.id });
  const reports = (await client.listUsageReports({ forceRefresh: true })).reports;
  const keeper = reports.filter(r => r.sourceId === "keeper-codex-quota");
  assert.deepEqual(keeper.map(r => r.report.status).sort(), ["available", "available", "error", "unavailable"]);
  const claude = reports.filter(r => r.sourceId === "claude-passive-quota");
  assert.equal(claude.length, 1);
  assert.deepEqual(claude[0].report.windows.map(w => [w.id, w.usedPct]), [
    ["five_hour", 23], ["seven_day", 61], ["seven_day_overage_included", 37],
  ]);
  assert.equal((await counts()).refresh, 0);
  assert.deepEqual(await rpc("keeper.refresh", { id: personal.sourceId }), { queued: 1, pending: 1, failed: 0 });
  assert.equal((await counts()).refresh, 1);
  const before = await rpc("config.preferences", { display: { showResetCountdown: false } });
  const reload = await client.reloadPlugin(demo);
  assert.equal(reload.status, "running");
  assert.deepEqual(await rpc("config.read"), before);
  const restored = await rpc("usage.overview");
  assert.deepEqual(restored.sources, overview.sources);
  assert.equal((await counts()).refresh, 1);
  assert.equal(restored.display.showResetCountdown, false);
  await rpc("config.preferences", { display: { showResetCountdown: true } });
}

const executable = await program("paseo");
const sandbox = await mkdtemp(join(tmpdir(), "provider-usage-demo-"));
const home = join(sandbox, "home");
const state = join(sandbox, "daemon");
const tools = join(sandbox, "bin");
const stage = join(sandbox, "demo");
const port = await freePort();
const address = `127.0.0.1:${port}`;
let daemon;
let client;
let ended;
let exited = false;
let failed = false;
try {
  for (const dir of [home, state, tools, stage]) await mkdir(dir, { mode: 0o700 });
  // Isolate command discovery, including the macOS Keychain CLI, from the user's PATH.
  for (const name of ["dirname", "readlink", "env"]) await symlink(await program(name), join(tools, name));
  await symlink(process.execPath, join(tools, "node"));
  const providers = Object.fromEntries(["claude", "codex", "copilot", "opencode", "pi", "antigravity"].map(p => [p, { enabled: false }]));
  await writeFile(join(state, "config.json"), JSON.stringify({
    pluginsEnabled: true, daemon: { relay: { enabled: false } }, agents: { providers },
  }), { mode: 0o600 });
  const mockDir = join(state, "provider-usage-mock");
  await mkdir(mockDir, { mode: 0o700 });
  await cp(join(root, "fixtures"), join(mockDir, "fixtures"), { recursive: true });
  for (const name of ["server", "client", "shared", "index.client.tsx", "paseo-plugin.json", "package.json"]) {
    await cp(join(root, name), join(stage, name), { recursive: true });
  }
  await cp(join(here, "mock-entry.ts"), join(stage, "index.server.ts"));

  const log = openSync(join(sandbox, "daemon.log"), "w", 0o600);
  daemon = spawn(executable, ["daemon", "run", "--home", state], {
    cwd: sandbox, stdio: ["ignore", log, log],
    env: { HOME: home, PASEO_HOME: state, PATH: tools, SHELL: "/bin/sh",
      PASEO_RELAY_ENABLED: "false", PASEO_LISTEN: address, PASEO_WEB_UI_ENABLED: String(ui) },
  });
  closeSync(log);
  ended = once(daemon, "exit").then(() => { exited = true; });
  let serverId;
  for (let i = 0; i < 180 && !exited; i++) {
    try {
      serverId = (await readFile(join(state, "server-id"), "utf8")).trim();
      await fetch(`http://${address}/`);
      break;
    } catch {}
    await delay(250);
  }
  assert.ok(serverId && !exited, "The isolated daemon did not start.");
  client = createHostClient(address, {
    clientId: "provider-usage-mock", clientType: "cli", connectTimeoutMs: 20000,
    localCredential: async () => (await readFile(join(state, "local-credential"), "utf8")).trim(),
  });
  await client.connect();
  assert.equal(client.getLastServerInfoMessage().serverId, serverId);
  async function install(path, pluginId) {
    const item = await client.installDirectoryPlugin(path, pluginId);
    if (item.status !== "running") throw new Error(`Failed to load ${pluginId}: ${JSON.stringify(item)}`);
  }
  await install(root, id);
  const clean = await client.invokePluginRpc(id, "config.read", {});
  assert.deepEqual(clean.instances, []);
  assert.equal((await client.invokePluginRpc(id, "usage.overview", {})).mock, false);
  await client.removePlugin(id);
  await install(stage, demoId);
  await verify(client, demoId, mockDir);
  console.log("Production install, mock settings, quota reports and reload passed.");
  if (ui) {
    console.log(`Open http://${address}/ in a browser. Press Ctrl+C here to stop.`);
    await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  }
} catch (error) {
  failed = true;
  console.error(`Daemon log: ${join(sandbox, "daemon.log")}`);
  throw error;
} finally {
  if (client) await client.close();
  if (daemon && !exited) { daemon.kill("SIGTERM"); await ended; }
  if (!failed) await rm(sandbox, { recursive: true, force: true });
}
