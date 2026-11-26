// Copied into the temporary demo installation as its server entry.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerPlugin } from "./server/paseo/plugin";
import { parseClaudeWindows } from "./server/sources/claude";
import { SettingsStore } from "./server/storage/store";
import { UsageService } from "./server/usage/service";
import { antigravitySnapshot } from "./shared/native-usage";

export default function contribute(server: PluginServerContext) {
  const directory = join(process.env.PASEO_HOME!, "provider-usage-mock");
  const fixture = (name: string) => JSON.parse(readFileSync(join(directory, "fixtures", name), "utf8"));
  const store = new SettingsStore(directory);
  const observedAt = "2026-11-26T05:32:00.000Z";
  const readAt = "2026-11-26T07:00:00.000Z";
  const personal = "https://personal.keeper.invalid";
  const secondary = "https://second.keeper.invalid";
  const password = "synthetic-demo-password";
  const marker = join(directory, ".seeded");
  if (!existsSync(marker)) {
    store.save({ label: "Personal Keeper", baseUrl: personal, password });
    store.save({ label: "Second Keeper", baseUrl: secondary });
    store.preferences({ claude: { enabled: true, providerId: "demo-reclaude" } });
    const events = parseClaudeWindows(fixture("claude/rate-limit-event.full.mock.json"));
    new UsageService(store, () => { throw new Error("Unexpected Keeper call during Claude seed."); }).claude.ingest(events, observedAt);
    writeFileSync(marker, "");
  }

  const countsFile = join(directory, "mock-requests.json");
  const counts: { cache: number; refresh: number } = existsSync(countsFile)
    ? JSON.parse(readFileSync(countsFile, "utf8")) : { cache: 0, refresh: 0 };
  function count(action: keyof typeof counts) {
    counts[action]++;
    writeFileSync(countsFile, JSON.stringify(counts));
  }
  const identities = fixture("keeper/identities.mock.json").identities;
  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (![personal, secondary].includes(url.origin)) throw new Error("Unknown demo endpoint.");
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const protectedInstance = url.origin === personal;
    if (method === "POST" && headers.get("X-CPA-Usage-Keeper-Request") !== "fetch") {
      return new Response(null, { status: 403 });
    }
    if (method === "POST" && url.pathname === "/api/v1/auth/login") {
      const login = JSON.parse(String(init?.body));
      if (login.password !== password || !protectedInstance) return new Response(null, { status: 401 });
      return new Response(null, {
        status: 204, headers: { "Set-Cookie": "cpa_usage_keeper_session=demo-session; Max-Age=3600; Path=/; HttpOnly" },
      });
    }
    if (protectedInstance && headers.get("cookie") !== "cpa_usage_keeper_session=demo-session") {
      return new Response(null, { status: 401 });
    }
    if (method === "GET" && url.pathname === "/api/v1/usage/identities") {
      return Response.json({ identities: protectedInstance ? identities : [identities[0]] });
    }
    if (method === "POST" && url.pathname === "/api/v1/quota/cache") {
      const { auth_indexes } = JSON.parse(String(init?.body));
      const result = fixture(protectedInstance ? "keeper/cache.mock.json" : "keeper/cache-failed.mock.json");
      count("cache");
      return Response.json({ items: result.items.filter((item: { auth_index: string }) => auth_indexes.includes(item.auth_index)) });
    }
    if (method === "POST" && url.pathname === "/api/v1/quota/refresh") {
      const { auth_indexes } = JSON.parse(String(init?.body));
      const expected = protectedInstance ? ["demo-plus", "demo-pro"] : ["demo-pro"];
      if (JSON.stringify([...auth_indexes].sort()) !== JSON.stringify(expected)) return new Response(null, { status: 400 });
      count("refresh");
      return Response.json(protectedInstance ? fixture("keeper/refresh.mock.json") : {
        tasks: [{ authIndex: "demo-pro" }], rejected: [], accepted: 1, skipped: 0, limit: 1,
      });
    }
    return new Response(null, { status: 404 });
  };
  return registerPlugin(server, store, {
    fetch: mockFetch, now: () => new Date(readAt),
    mockNative: antigravitySnapshot(fixture("native/provider-list.mock.json"), fixture("native/provider-catalog.mock.json")),
  });
}
