import type { PluginServerContext } from "@getpaseo/plugin/server";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import { windowSchema, type ClaudeSettings, type QuotaWindow } from "../../shared/types";
import { claudeWindowIds } from "./claude-protocol.cjs";
export { parseClaudeWindows } from "./claude-protocol.cjs";

type Options = {
  directory: string;
  settings: () => ClaudeSettings;
  ingest: (windows: QuotaWindow[], observedAt: string) => void;
};

const observation = z.array(windowSchema.extend({ id: z.enum(claudeWindowIds) })).min(1).max(claudeWindowIds.length);
const socketEnv = "PASEO_PROVIDER_USAGE_SOCKET";

function openReceiver(directory: string, receive: (windows: QuotaWindow[]) => void) {
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
        const parsed = observation.safeParse(JSON.parse(Buffer.concat(parts).toString("utf8")));
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
  const invalidate = () => {
    receiver?.close();
    receiver = undefined;
  };
  const removeHook = server.addHook("agent.open.before", async ({request}) => {
    const settings = options.settings();
    if (!settings.enabled || request.provider !== settings.providerId ||
        request.purpose !== "interactive" || request.reason === "import") return;
    try {
      // Each settings generation has a private endpoint. Old sessions and
      // connections cannot become active again after the switch is toggled.
      receiver ??= openReceiver(options.directory, windows => {
        if (options.settings().enabled && options.settings().providerId === request.provider) {
          options.ingest(windows, new Date().toISOString());
        }
      });
      const current = receiver;
      if (await current.ready && receiver === current) {
        return {...request, env: {...request.env, [socketEnv]: current.path}};
      }
      if (receiver === current) invalidate();
    } catch {
      // Unwritable state or unavailable local IPC must leave the launch usable.
      invalidate();
    }
  });
  return {
    invalidate,
    dispose() { removeHook(); invalidate(); },
  };
}
