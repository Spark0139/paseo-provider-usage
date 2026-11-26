import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createHash } from "node:crypto";
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { z } from "zod";
import { windowSchema, type ClaudeSettings, type QuotaWindow } from "../../shared/types";
import { claudeCommand } from "../paseo/claude-config";
import { launchClaude } from "./claude-launcher.cjs";
import { claudeWindowIds, createClaudeProtocol } from "./claude-protocol.cjs";
export { parseClaudeWindows } from "./claude-protocol.cjs";

type Options = {
  directory: string;
  settings: () => ClaudeSettings;
  ingest: (windows: QuotaWindow[], observedAt: string) => void;
};

const observation = z.array(windowSchema.extend({ id: z.enum(claudeWindowIds) })).min(1).max(claudeWindowIds.length);
// The server bundle is evaluated without an installation path. Both functions
// are self-contained so that a launch stays valid after its receiver is closed.
const launcher = `(${launchClaude.toString()})(require, (${createClaudeProtocol.toString()})().parseClaudeWindows)`;

function findNode() {
  if (!process.versions.electron) return process.execPath;
  // Desktop uses Electron as Node internally. Paseo removes its run-as-Node
  // flag for external launches. Use an actual Node executable in that case.
  const name = process.platform === "win32" ? "node.exe" : "node";
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const path = join(directory, name);
    try {
      accessSync(path, constants.X_OK);
      if (statSync(path).isFile()) return path;
    } catch {
      // Try the next absolute directory.
    }
  }
}

function openReceiver(directory: string, connected: () => void, receive: (windows: QuotaWindow[]) => void) {
  // sockaddr_un is limited to 103 usable bytes on macOS. Only the short-lived
  // socket goes in a private temp directory when the daemon home is long.
  const prefix = join(directory, "cc-");
  const parentPrefix = Buffer.byteLength(prefix) < 80 ? prefix : "/tmp/paseo-cc-";
  if (parentPrefix === prefix) mkdirSync(directory, {recursive: true, mode: 0o700});
  const root = mkdtempSync(parentPrefix);
  const path = join(root, "events.sock");
  const clients = new Set<Socket>();
  let closed = false;
  const listener = createServer(client => {
    clients.add(client);
    const parts: Buffer[] = [];
    let size = 0;
    client.setTimeout(1000, () => client.destroy());
    client.on("error", () => client.destroy());
    client.on("close", () => clients.delete(client));
    client.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2048) client.destroy();
      else parts.push(chunk);
    });
    client.on("end", () => {
      if (closed || size > 2048) return;
      try {
        const message: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
        if (message === "launcher-connected") { connected(); return; }
        const parsed = observation.safeParse(message);
        if (parsed.success) receive(parsed.data);
      } catch {
        // A malformed observation or broken cache must never break an agent.
      }
    });
  });
  let finishStartup!: (started: boolean) => void;
  const ready = new Promise<boolean>(resolve => { finishStartup = resolve; });
  function close() {
    if (closed) return;
    closed = true;
    finishStartup(false);
    for (const client of clients) client.destroy();
    listener.close();
    rmSync(root, {recursive: true, force: true});
  }
  listener.on("error", close);
  listener.listen(path, () => finishStartup(!closed));
  return { path, ready, close };
}

export function registerClaude(server: PluginServerContext, options: Options) {
  let receiver: ReturnType<typeof openReceiver> | undefined;
  const wrapSupport = new Map<string, boolean>();
  let stage: "waitingSession" | "sessionOpened" | "connected" | "observed" | "receiverError" |
    "wrapConflict" | "legacyLauncher" | "wrapUnavailable" = "waitingSession";
  const invalidate = () => {
    receiver?.close();
    receiver = undefined;
    stage = "waitingSession";
  };
  const removeHook = server.addHook("agent.open.before", async ({request}, {paseo, signal}) => {
    const settings = options.settings();
    if (!settings.enabled || request.provider !== settings.providerId ||
        request.purpose !== "interactive" || request.reason === "import") return;
    if (request.wrap) {
      stage = "wrapConflict";
      return;
    }
    try {
      const { config } = await paseo.config.get();
      if (signal.aborted || options.settings() !== settings) return;
      const command = claudeCommand(config.providers, request.provider);
      if (!command) return;
      if (command.some(arg => basename(arg) === "claude-launch.cjs")) {
        stage = "legacyLauncher";
        return;
      }
      let canWrap = wrapSupport.get(request.provider);
      if (canWrap === undefined) {
        // The capability is fixed for a daemon's Claude adapter. Avoid warming
        // Paseo's provider catalog on every subsequent session open.
        const { entries } = await paseo.providers.snapshot();
        if (signal.aborted || options.settings() !== settings) return;
        const entry = entries.find(entry => entry.provider === request.provider);
        canWrap = entry?.launchWrap === true;
        if (entry) wrapSupport.set(request.provider, canWrap);
      }
      if (!canWrap) {
        stage = "wrapUnavailable";
        return;
      }

      const node = findNode();
      if (!node) {
        stage = "receiverError";
        return;
      }
      // Paseo replaces the SDK's bare Node/Bun command with its runtime path.
      const prefix = command[0] === "node" || command[0] === "bun"
        ? [process.execPath, ...command.slice(1)]
        : command;
      const digest = prefix.length ? createHash("sha256").update(JSON.stringify(prefix)).digest("hex") : "";
      // Each settings generation has a private endpoint. Old sessions and
      // connections cannot become active again after the switch is toggled.
      receiver ??= openReceiver(options.directory, () => {
        if (stage !== "observed") stage = "connected";
      }, windows => {
        if (options.settings().enabled && options.settings().providerId === request.provider) {
          options.ingest(windows, new Date().toISOString());
          stage = "observed";
        }
      });
      const current = receiver;
      if (await current.ready && receiver === current && !signal.aborted) {
        if (stage !== "connected" && stage !== "observed") stage = "sessionOpened";
        return {
          ...request,
          wrap: [node, "--input-type=commonjs", "-e", launcher, "--", current.path, String(prefix.length), digest],
        };
      }
      if (signal.aborted) return;
      if (receiver === current) { invalidate(); stage = "receiverError"; }
    } catch {
      // Unwritable state or unavailable local IPC must leave the launch usable.
      if (!signal.aborted && options.settings() === settings) stage = "receiverError";
    }
  });
  return {
    stage: () => options.settings().enabled ? stage : "disabled" as const,
    invalidate,
    dispose() { removeHook(); invalidate(); },
  };
}
