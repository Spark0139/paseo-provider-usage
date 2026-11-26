import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { PluginServerContext, PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import { claudeProviderSetup } from "../server/paseo/claude-config";
import { parseClaudeWindows, registerClaude } from "../server/sources/claude";
import type { QuotaWindow } from "../shared/types";

const fixture = (name: string) => readFile(join("fixtures", "claude", name), "utf8");
const wrapper = join(process.cwd(), "server", "sources", "claude-launch.cjs");

test("Claude subscription windows and partial SDK events", async () => {
  const full = JSON.parse(await fixture("rate-limit-event.full.mock.json"));
  const windows = parseClaudeWindows(full);
  assert.deepEqual(windows.map(w => [w.id, 100 - w.usedPercent!, w.resetAt]), [
    ["five_hour", 77, "2026-11-26T08:45:00.000Z"],
    ["seven_day", 39, "2026-11-30T15:00:00.000Z"],
    ["seven_day_overage_included", 63, "2026-12-02T15:00:00.000Z"],
  ]);
  assert.deepEqual(parseClaudeWindows(JSON.parse(await fixture("rate-limit-event.partial.mock.json"))), []);
  assert.deepEqual(parseClaudeWindows({type: "assistant", rate_limit_info: full.rate_limit_info}), []);
  assert.deepEqual(parseClaudeWindows({type: "rate_limit_event", rate_limit_info: {
    rateLimitType: "five_hour", utilization: .25, resetsAt: 1e100,
  }}).map(w => [w.usedPercent, w.resetAt]), [[25, null]]);
});

test("Fable uses its own measured window and explicitly scoped status", async () => {
  const full = JSON.parse(await fixture("rate-limit-event.full.mock.json"));
  const fable = "seven_day_overage_included";
  delete full.rate_limit_info.unifiedWindows[fable];
  full.rate_limit_info.unifiedWindows.overage = { utilization: .8, resetsAt: 1796223600 };
  assert.deepEqual(parseClaudeWindows(full).map(window => window.id), ["five_hour", "seven_day"]);

  const info = { rateLimitType: fable, status: "rejected", resetsAt: 1796223600 };
  const parse = (rate_limit_info: object) => parseClaudeWindows({ type: "rate_limit_event", rate_limit_info });
  const [partial] = parse(info);
  assert.deepEqual(partial, { id: fable, label: "Fable 周额度", durationSeconds: 604800, usedPercent: null,
    status: "rejected", resetAt: "2026-12-02T15:00:00.000Z" });
  assert.deepEqual(parse({ ...info, utilization: .91 }), [{ ...partial, usedPercent: 91 }]);
  assert.deepEqual(parse({ ...info, unifiedWindows: { [fable]: { utilization: 1, resetsAt: 1796223600 } } }),
    [{ ...partial, usedPercent: 100 }]);
  assert.deepEqual(parse({ ...info, rateLimitType: "overage", utilization: 1 }), []);
  assert.deepEqual(parse({ ...info, utilization: 1.1 }), []);
});

test("interactive provider launch forwards protocol bytes and isolates private observations", async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "claude-usage-test-")));
  t.after(() => rm(directory, {recursive: true, force: true}));
  type Hook = (input: {request: PluginSessionOpenRequest}) => Promise<PluginSessionOpenRequest | undefined>;
  let hook!: Hook;
  const server = { addHook(_name: string, callback: Hook) { hook = callback; return () => {}; } };
  const settings = {enabled: true, providerId: "test-reclaude"};
  const received: QuotaWindow[][] = [];
  const collector = registerClaude(server as unknown as PluginServerContext, {
    directory, settings: () => settings, ingest(windows) { received.push(windows); },
  });
  t.after(() => collector.dispose());
  const request: PluginSessionOpenRequest = {
    agentId: "test", provider: "test-reclaude", workspaceId: null, cwd: directory,
    title: null, background: false, labels: {}, metadata: {}, tools: [], env: {}, mcpServers: {},
    reason: "create", purpose: "interactive",
  };
  for (const change of [{purpose: "history"}, {reason: "import"}, {provider: "codex"}] as const) {
    assert.equal(await hook({request: {...request, ...change}}), undefined);
  }
  assert.equal(collector.stage(), "waitingSession");
  const endpoint = (await hook({request}))!.env.PASEO_PROVIDER_USAGE_SOCKET;
  assert.equal((await stat(dirname(endpoint))).mode & 0o777, 0o700);

  assert.equal(collector.stage(), "sessionOpened");
  const quiet = spawn(process.execPath, [wrapper, process.execPath, "-e", "process.stdout.write('quiet')"], {
    env: { PASEO_PROVIDER_USAGE_SOCKET: endpoint },
  });
  quiet.stdout.resume();
  assert.deepEqual(await once(quiet, "close"), [0, null]);
  assert.equal(collector.stage(), "connected");
  assert.equal(received.length, 0);

  const stream = await fixture("stream.mock.ndjson");
  const input = Buffer.from(JSON.stringify({type: "control_request", text: "分块"}) + "\n");
  const oversized = "x".repeat(70_000);
  const stdout = Buffer.from(oversized + "\n" + "broken json\n" + stream);
  const script = `
    (async () => {
      const packets = [];
      for await (const chunk of process.stdin) packets.push(chunk);
      if (Buffer.concat(packets).toString("base64") !== process.env.EXPECT_INPUT ||
          process.cwd() !== process.env.EXPECT_CWD || process.argv[1] !== "original argument" ||
          process.env.PASEO_PROVIDER_USAGE_SOCKET !== undefined) process.exit(24);
      process.stderr.write("separate stderr\\n");
      const frame = Buffer.from(process.env.STREAM, "base64");
      for(let i = 0; i < frame.length; i += 19) process.stdout.write(frame.subarray(i, i + 19));
      process.exitCode = 23;
    })().catch(() => process.exitCode = 1);
  `;
  async function launch(path: string) {
    const child = spawn(process.execPath, [wrapper, process.execPath, "-e", script, "original argument"], {
      cwd: directory, stdio: ["pipe", "pipe", "pipe"], env: {
        EXPECT_INPUT: input.toString("base64"), EXPECT_CWD: directory,
        STREAM: stdout.toString("base64"), PASEO_PROVIDER_USAGE_SOCKET: path,
      },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.stdin.end(input);
    assert.deepEqual(await once(child, "close"), [23, null]);
    assert.deepEqual(Buffer.concat(out), stdout);
    assert.equal(Buffer.concat(err).toString(), "separate stderr\n");
  }
  await launch(endpoint);
  assert.equal(collector.stage(), "observed");
  assert.deepEqual(received.map(row => row.map(w => w.usedPercent)), [[23, 61, 37]]);

  const unrelated = createConnection(endpoint);
  const ignored = once(unrelated, "close");
  unrelated.end(JSON.stringify([{ ...received[0][2], id: "overage" }]));
  await ignored;
  assert.equal(received.length, 1);

  // An already-connected sender and a still-running launcher both lose their
  // previous generation, even if the same provider gets enabled immediately.
  const oldSocket = createConnection(endpoint);
  oldSocket.on("error", () => {});
  await once(oldSocket, "connect");
  settings.enabled = false;
  collector.invalidate();
  assert.equal(collector.stage(), "disabled");
  assert.equal(await hook({request}), undefined);
  settings.enabled = true;
  assert.equal(collector.stage(), "waitingSession");
  const renewed = (await hook({request: {...request, reason: "refresh"}}))!.env.PASEO_PROVIDER_USAGE_SOCKET;
  assert.notEqual(endpoint, renewed);
  oldSocket.end(JSON.stringify(received[0]));
  await launch(endpoint);
  assert.equal(received.length, 1);
  await launch(renewed);
  assert.equal(received.length, 2);
});

test("launcher relays signals in both directions", async () => {
  const child = spawn(process.execPath, [wrapper, process.execPath, "-e",
    'process.on("SIGTERM", () => { process.stderr.write("terminated"); process.kill(process.pid, "SIGKILL"); }); process.stdout.write("ready"); setInterval(() => {}, 1000);',
  ], {stdio: ["ignore", "pipe", "pipe"], env: {}});
  const [ready] = await once(child.stdout, "data");
  assert.equal(ready.toString(), "ready");
  const err: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
  const result = once(child, "close");
  child.kill("SIGTERM");
  assert.deepEqual(await result, [null, "SIGKILL"]);
  assert.equal(Buffer.concat(err).toString(), "terminated");
});

test("Claude setup exposes only profile IDs, labels and whether the effective command lists the launcher", () => {
  const config = {
    claude: { command: ["/private/node", "/private/claude-launch.cjs", "/private/reclaude", "--private-arg"] },
    work: { extends: "claude", label: "Work", env: { DEMO_SECRET: "redacted" } },
    bare: { extends: "claude", command: ["/private/reclaude"] },
    hidden: { extends: "claude", enabled: false },
    other: { extends: "codex" },
  };
  const selection = claudeProviderSetup(config, "work");
  assert.deepEqual(selection, {
    providers: [{ id: "claude", label: "Claude" }, { id: "work", label: "Work" }, { id: "bare", label: "bare" }],
    launcher: "listed",
  });
  assert.equal(claudeProviderSetup(config, "bare").launcher, "unlisted");
  assert.equal(claudeProviderSetup(config, "hidden").launcher, "unknown");
  assert.equal(claudeProviderSetup(config, "other").launcher, "unknown");
});
