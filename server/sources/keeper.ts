import { z } from "zod";
import type { KeeperRefreshResult } from "../../shared/contracts";
import type { KeeperInstance } from "../../shared/types";
import { accountFromCache, cacheItems, codexIdentities } from "./keeper-quota";

const sessionName = "cpa_usage_keeper_session";
const intent = { "X-CPA-Usage-Keeper-Request": "fetch", "Content-Type": "application/json" };
const refreshResponse = z.object({
  tasks: z.array(z.object({ authIndex: z.string() })).nullable(),
  rejected: z.array(z.object({ authIndex: z.string(), error: z.string() })).nullable(),
  accepted: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), limit: z.number().int().nonnegative(),
});

const taskResponse = z.object({ authIndex: z.string(), status: z.enum(["queued", "running", "completed", "failed"]) });
export type TaskStatus = z.infer<typeof taskResponse>["status"] | "missing";
export type KeeperSubmission = KeeperRefreshResult & { indexes: string[] };

export class KeeperHttpError extends Error {
  constructor(readonly status: number, message: string, readonly retryAt = 0) { super(message); }
}

type Session = { cookie: string; expiresAt: number };
type Path = "/auth/login" | "/usage/identities" | "/quota/cache" | "/quota/refresh" | `/quota/refresh/${string}`;

function sessionCookie(headers: Headers, secure: boolean): Session | null {
  const raw = headers.getSetCookie().find(value => value.startsWith(sessionName + "="));
  if (!raw) return null; // Keeper returns 204 without a cookie when password protection is off.
  const [cookie, ...attributes] = raw.split(";").map(part => part.trim());
  const params = new Map(attributes.map(part => {
    const [key, value] = part.split("=");
    return [key.toLowerCase(), value];
  }));
  const maxAge = params.get("max-age");
  const expires = params.get("expires");
  let expiresAt = expires ? Date.parse(expires) : Infinity;
  if (maxAge !== undefined) expiresAt = Date.now() + Number(maxAge) * 1000;
  if ((params.has("secure") && !secure) || !cookie.slice(sessionName.length + 1) || !(expiresAt > Date.now())) {
    throw new Error("Keeper 返回的登录会话无效。");
  }
  return { cookie, expiresAt };
}

export function createKeeperClient(instance: KeeperInstance, password: string, options: { fetch?: typeof fetch } = {}) {
  const send = options.fetch ?? fetch;
  const base = instance.baseUrl.replace(/\/+$/, "") + "/api/v1";
  let session: Session | null = null;
  let retryAt = 0;
  let loginPending: Promise<Session | null> | undefined;

  async function exchange(path: Path, bound: Session | null, body?: object) {
    if (Date.now() < retryAt) throw new KeeperHttpError(429, "Keeper 请求受限，稍后重试（HTTP 429）。", retryAt);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await send(base + path, {
        method: body ? "POST" : "GET",
        headers: { ...(body && intent), ...(bound && { Cookie: bound.cookie }) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual", signal: controller.signal,
      });
      const { status, headers } = response;
      if (status === 429) {
        const raw = headers.get("retry-after")?.trim();
        const until = raw && /^\d+$/.test(raw) ? Date.now() + Number(raw) * 1000 : Date.parse(raw ?? "");
        retryAt = Math.max(retryAt, Number.isFinite(until) ? until : Date.now() + 60_000);
      }
      if (!response.ok || path === "/auth/login") {
        await response.body?.cancel();
        return { status, headers, data: undefined };
      }
      return { status, headers, data: await response.json() as unknown };
    } catch {
      throw new Error(controller.signal.aborted ? "Keeper 请求超时。" : "读取 Keeper 响应失败。");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function login() {
    const { status, headers } = await exchange("/auth/login", null, { password });
    if (status !== 204) throw new KeeperHttpError(status, `Keeper 登录失败（HTTP ${status}）。`, retryAt);
    session = sessionCookie(headers, new URL(base).protocol === "https:");
    return session;
  }

  const currentSession = () => session && session.expiresAt > Date.now() ? session : null;
  async function request(path: Exclude<Path, "/auth/login">, body?: object): Promise<unknown> {
    const used = currentSession();
    let response = await exchange(path, used, body);
    if (response.status === 401) {
      if (!password) throw new KeeperHttpError(401, "Keeper 需要登录密码（HTTP 401）。");
      if (session === used) session = null;
      let replacement = currentSession();
      if (!replacement) {
        loginPending ??= login().finally(() => { loginPending = undefined; });
        replacement = await loginPending;
      }
      response = await exchange(path, replacement, body);
    }
    if (response.status < 200 || response.status >= 300) throw new KeeperHttpError(response.status, `Keeper 请求失败（HTTP ${response.status}）。`, retryAt);
    return response.data;
  }

  const discover = async () => codexIdentities(await request("/usage/identities"));
  return {
    async test() { return (await discover()).length; },

    async read() {
      const identities = await discover();
      const indexes = identities.map(item => item.identity).filter(Boolean);
      if (!indexes.length) return identities.map(item => accountFromCache(item));
      const cache = cacheItems(await request("/quota/cache", { auth_indexes: indexes }));
      return identities.map(item => accountFromCache(item, cache.get(item.identity)));
    },

    async requestRefresh(): Promise<KeeperSubmission> {
      const identities = await discover();
      const indexes = new Set(identities.filter(item => item.disabled === false && item.identity).map(item => item.identity));
      if (!indexes.size) return { queued: 0, pending: 0, failed: 0, indexes: [] };
      const parsed = refreshResponse.safeParse(await request("/quota/refresh", { auth_indexes: [...indexes] }));
      if (!parsed.success) throw new Error("Keeper 返回的更新任务结果无效。");
      const { tasks, rejected, limit, accepted, skipped } = parsed.data;
      const acknowledged = [...(tasks ?? []), ...(rejected ?? [])].map(item => item.authIndex);
      if (limit !== indexes.size || accepted + skipped !== limit || (tasks?.length ?? 0) !== accepted ||
          new Set(acknowledged).size !== acknowledged.length || acknowledged.some(index => !indexes.has(index))) {
        throw new Error("Keeper 返回的更新任务结果无效。");
      }
      // Unsupported credentials may be skipped without a rejected row.
      const duplicate = (rejected ?? []).filter(item => item.error === "duplicate");
      const tracked = [...(tasks ?? []), ...duplicate].map(item => item.authIndex);
      return { queued: accepted, pending: duplicate.length, failed: skipped - duplicate.length, indexes: tracked };
    },

    async taskStatus(index: string): Promise<TaskStatus> {
      // Dot segments are normalized by URL parsers, even when the dots are percent-encoded.
      if (index === "." || index === "..") return "missing";
      try {
        const data = await request(`/quota/refresh/${encodeURIComponent(index)}`);
        const result = taskResponse.safeParse(data);
        if (!result.success || result.data.authIndex !== index) throw new Error("Keeper 返回的任务状态无效。");
        return result.data.status;
      } catch (error) {
        if (error instanceof KeeperHttpError && error.status === 404) return "missing";
        throw error;
      }
    },
  };
}
