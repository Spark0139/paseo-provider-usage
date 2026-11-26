import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";
import type { PluginHookContext, PluginServerContext, PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import { claudeCommand, listClaudeProviders } from "../server/paseo/claude-config";
import { parseClaudeWindows, registerClaude } from "../server/sources/claude";
import type { QuotaWindow } from "../shared/types";

const fixture = (name: string) => readFile(join("fixtures", "claude", name), "utf8");
const sdkArgs = ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json"];

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

test("Claude wraps an eligible SDK launch and passes through auxiliary processes", async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "claude-usage-test-")));
  t.after(() => rm(directory, {recursive: true, force: true}));
  type Hook = (input: {request: PluginSessionOpenRequest}, context: PluginHookContext) =>
    Promise<PluginSessionOpenRequest | undefined>;
  let hook!: Hook;
  const server = { addHook(_name: string, callback: Hook) { hook = callback; return () => {}; } };
  const settings = { enabled: true, providerId: "test-reclaude" };
  const received: QuotaWindow[][] = [];
  const collector = registerClaude(server as unknown as PluginServerContext, {
    directory, settings: () => settings, ingest(windows) { received.push(windows); },
  });
  t.after(() => collector.dispose());

  const request: PluginSessionOpenRequest = {
    agentId: "test", provider: "test-reclaude", workspaceId: null, cwd: directory,
    title: null, background: false, labels: {}, metadata: {}, tools: [], env: { EXAMPLE: "forwarded" }, mcpServers: {},
    reason: "create", purpose: "interactive",
  };
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
          process.env.EXAMPLE !== "forwarded" || process.env.PASEO_PROVIDER_USAGE_SOCKET !== undefined) process.exit(24);
      process.stderr.write("separate stderr\\n");
      const frame = Buffer.from(process.env.STREAM, "base64");
      for (let i = 0; i < frame.length; i += 19) process.stdout.write(frame.subarray(i, i + 19));
      process.exitCode = 23;
    })().catch(() => { process.exitCode = 1; });
  `;
  const original = [process.execPath, "-e", script, "--", "original argument"];
  const providers: MutableDaemonConfig["providers"] = { "test-reclaude": { extends: "claude", command: original } };
  let capabilities: Record<string, unknown>[] = [];
  let configReads = 0;
  let snapshotReads = 0;
  const context = {
    paseo: {
      config: { get: async () => { configReads++; return { config: { providers } }; } },
      providers: { snapshot: async () => { snapshotReads++; return { entries: capabilities }; } },
    },
    signal: new AbortController().signal,
  } as unknown as PluginHookContext;
  const open = (changes: Partial<PluginSessionOpenRequest> = {}) => hook({ request: { ...request, ...changes } }, context);
  for (const change of [{purpose: "history"}, {reason: "import"}, {provider: "codex"}] as const) {
    assert.equal(await open(change), undefined);
  }
  assert.equal(collector.stage(), "waitingSession");
  assert.equal(configReads, 0);
  assert.equal(await open({ wrap: ["/opt/other-wrap"] }), undefined);
  assert.equal(collector.stage(), "wrapConflict");
  assert.equal(configReads, 0);

  providers["test-reclaude"].command = [process.execPath, "/legacy/claude-launch.cjs", ...original];
  assert.equal(await open(), undefined);
  assert.equal(collector.stage(), "legacyLauncher");
  assert.equal(snapshotReads, 0);
  providers["test-reclaude"].command = original;

  // Older daemon snapshots don't have launchWrap. Provide an empty snapshot
  // first so this collector can also exercise the supported launch path.
  assert.equal(await open(), undefined);
  assert.equal(collector.stage(), "wrapUnavailable");
  capabilities = [{ provider: "test-reclaude", launchWrap: true }];

  const launchRequest = (await open())!;
  assert.deepEqual(launchRequest.env, request.env);
  const [node, ...wrap] = launchRequest.wrap!;
  assert.ok(isAbsolute(node));
  const endpoint = wrap[4];
  assert.equal((await stat(dirname(endpoint))).mode & 0o777, 0o700);
  assert.equal(collector.stage(), "sessionOpened");
  assert.equal(snapshotReads, 2);

  async function launch(prefix: readonly string[], executable: string[], marker = true, output = stdout) {
    const child = spawn(node, [...prefix, ...executable], {
      cwd: directory, stdio: ["pipe", "pipe", "pipe"], env: {
        ...launchRequest.env,
        EXPECT_INPUT: input.toString("base64"), EXPECT_CWD: directory,
        STREAM: output.toString("base64"), ...(marker ? { CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" } : {}),
      },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.stdin.end(input);
    assert.deepEqual(await once(child, "close"), [23, null]);
    assert.deepEqual(Buffer.concat(out), output);
    assert.equal(Buffer.concat(err).toString(), "separate stderr\n");
  }
  // Unrelated stdout is preserved even if it contains the Claude fixture.
  await launch(wrap, original);
  await launch(wrap, [...original, ...sdkArgs], false);
  const otherExecutable = [process.execPath, "-e", script + "\n", "--", "original argument"];
  await launch(wrap, [...otherExecutable, ...sdkArgs]);
  assert.equal(collector.stage(), "sessionOpened");
  assert.equal(received.length, 0);

  const sdkExecutable = [...original, ...sdkArgs];
  await launch(wrap, sdkExecutable, true, Buffer.alloc(0));
  assert.equal(collector.stage(), "connected");
  assert.equal(received.length, 0);
  await launch(wrap, sdkExecutable);
  assert.equal(collector.stage(), "observed");
  assert.deepEqual(received.map(row => row.map(w => w.usedPercent)), [[23, 61, 37]]);

  const unrelated = createConnection(endpoint);
  const ignored = once(unrelated, "close");
  unrelated.end(JSON.stringify([{ ...received[0][2], id: "overage" }]));
  await ignored;
  assert.equal(received.length, 1);

  // Previous launches retain their executable wrap while losing the old receiver.
  const oldSocket = createConnection(endpoint);
  oldSocket.on("error", () => {});
  await once(oldSocket, "connect");
  settings.enabled = false;
  collector.invalidate();
  assert.equal(collector.stage(), "disabled");
  assert.equal(await open(), undefined);
  settings.enabled = true;
  assert.equal(collector.stage(), "waitingSession");
  const [, ...renewed] = (await open({ reason: "refresh" }))!.wrap!;
  assert.notEqual(endpoint, renewed[4]);
  assert.equal(snapshotReads, 2);
  oldSocket.end(JSON.stringify(received[0]));
  await launch(wrap, sdkExecutable);
  assert.equal(received.length, 1);
  await launch(renewed, sdkExecutable);
  assert.equal(received.length, 2);
});

test("launcher relays signals in both directions", async () => {
  const { launchClaude } = await import("../server/sources/claude-launcher.cjs");
  const code = `(${launchClaude.toString()})(require, () => [])`;
  const child = spawn(process.execPath, ["-e", code, "--", "", "0", "", process.execPath, "-e",
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

test("Claude setup exposes enabled Provider IDs and labels and inherits the base command", () => {
  const config = {
    claude: { command: ["/private/reclaude", "--private-arg"] },
    work: { extends: "claude", label: "Work", env: { DEMO_SECRET: "redacted" } },
    bare: { extends: "claude", command: ["/private/other"] },
    hidden: { extends: "claude", enabled: false },
    other: { extends: "codex" },
  };
  assert.deepEqual(listClaudeProviders(config),
    [{ id: "claude", label: "Claude" }, { id: "work", label: "Work" }, { id: "bare", label: "bare" }]);
  assert.deepEqual(claudeCommand(config, "work"), config.claude.command);
  assert.deepEqual(claudeCommand(config, "bare"), config.bare.command);
  assert.deepEqual(claudeCommand({}, "claude"), []);
  assert.equal(claudeCommand(config, "hidden"), null);
  assert.equal(claudeCommand(config, "other"), null);
});
