import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { PluginServerContext, PluginSessionOpenRequest } from "@getpaseo/plugin/server";
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
  ]);
  assert.deepEqual(parseClaudeWindows(JSON.parse(await fixture("rate-limit-event.partial.mock.json"))), []);
  assert.deepEqual(parseClaudeWindows({type: "assistant", rate_limit_info: full.rate_limit_info}), []);
  assert.deepEqual(parseClaudeWindows({type: "rate_limit_event", rate_limit_info: {
    rateLimitType: "five_hour", utilization: .25, resetsAt: 1e100,
  }}).map(w => [w.usedPercent, w.resetAt]), [[25, null]]);
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
  const endpoint = (await hook({request}))!.env.PASEO_PROVIDER_USAGE_SOCKET;
  assert.equal((await stat(dirname(endpoint))).mode & 0o777, 0o700);

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
  assert.deepEqual(received.map(row => row.map(w => w.usedPercent)), [[23, 61]]);

  // An already-connected sender and a still-running launcher both lose their
  // previous generation, even if the same provider gets enabled immediately.
  const oldSocket = createConnection(endpoint);
  oldSocket.on("error", () => {});
  await once(oldSocket, "connect");
  settings.enabled = false;
  collector.invalidate();
  assert.equal(await hook({request}), undefined);
  settings.enabled = true;
  const renewed = (await hook({request}))!.env.PASEO_PROVIDER_USAGE_SOCKET;
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
