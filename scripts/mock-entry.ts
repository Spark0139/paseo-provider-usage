// Copied into the temporary demo installation as its server entry.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerPlugin } from "./server/paseo/plugin";
import { parseClaudeWindows } from "./server/sources/claude";
import { SettingsStore } from "./server/storage/store";
import { UsageService } from "./server/usage/service";
import { snapshotSchema } from "./shared/types";

export default function contribute(server: PluginServerContext) {
  const directory = join(process.env.PASEO_HOME!, "provider-usage-mock");
  const fixture = (name: string) => JSON.parse(readFileSync(join(directory, "fixtures", name), "utf8"));
  const store = new SettingsStore(directory);
  const observedAt = "2026-11-26T05:32:00.000Z";
  const personal = "https://personal.cpa.invalid";
  const secondary = "https://second.cpa.invalid";
  const key = "synthetic-demo-key";
  if (!existsSync(join(directory, "config.json"))) {
    store.save({ label: "Personal CPA", baseUrl: personal, key });
    store.save({ label: "Second CPA", baseUrl: secondary, key });
    store.preferences({ claude: { enabled: true, providerId: "claude" } });
    const events = parseClaudeWindows(fixture("claude/rate-limit-event.full.mock.json"));
    new UsageService(store, async () => []).ingest(events, observedAt);
  }
  const credentials = fixture("cpa/v8/credentials.mock.json");
  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (![personal, secondary].includes(url.origin)) throw new Error("Unknown demo endpoint.");
    if (new Headers(init?.headers).get("authorization") !== "Bearer " + key) {
      return new Response(null, { status: 401 });
    }
    if (init?.method === "GET" && url.pathname === "/v8/management/credentials") {
      return Response.json(url.origin === secondary ? { files: [credentials.files[0]] } : credentials);
    }
    if (init?.method !== "POST" || url.pathname !== "/v8/management/requests/api-call") {
      return new Response(null, { status: 404 });
    }
    const index = JSON.parse(String(init.body)).auth_index;
    const result = url.origin === secondary ? "rejected" : index === "mock-idx-01" ? "available" : "exhausted";
    return Response.json(fixture(`cpa/v8/api-call.${result}.mock.json`));
  };
  const native = fixture("native/usage.mock.json").reports[0];
  return registerPlugin(server, store, {
    fetch: mockFetch, now: () => new Date(observedAt),
    mockNative: snapshotSchema.parse({ ...native, kind: "native", lastAttemptAt: observedAt, lastSuccessAt: observedAt }),
  });
}
