import { createHash } from "node:crypto";
import { z } from "zod";
import type { Account, QuotaWindow } from "../../shared/types";

const plan = z.object({ provider: z.string(), plan: z.string() }).nullish();
const identitySchema = z.object({
  id: z.string(), identity: z.string().trim(), name: z.string(), displayName: z.string(), type: z.string(),
  auth_type: z.number().int(), is_deleted: z.boolean(), disabled: z.boolean().nullish(), subscription: plan,
});
const identityList = z.object({ identities: z.array(identitySchema) });
type Identity = z.infer<typeof identitySchema>;

export function codexIdentities(value: unknown): Identity[] {
  const parsed = identityList.safeParse(value);
  if (!parsed.success) throw new Error("Keeper 返回的账号列表格式有误。");
  return parsed.data.identities.filter(i => i.auth_type === 1 && i.type.toLowerCase() === "codex" && !i.is_deleted);
}

const rowSchema = z.object({
  key: z.string().min(1), label: z.string().optional(), scope: z.string().optional(), metric: z.string().optional(),
  window: z.object({ seconds: z.number().int().positive().optional() }).optional(),
  usedPercent: z.number().min(0).max(100).nullish(), resetAt: z.string().optional(),
  resetAfterSeconds: z.number().nonnegative().optional(), limitReached: z.boolean().optional(), allowed: z.boolean().optional(),
});
const cachedQuota = z.object({ id: z.string(), quota: z.array(rowSchema).nullable(), subscription: plan });
const cachedItem = z.object({
  auth_index: z.string(), status: z.enum(["completed", "failed"]), refreshed_at: z.string().optional(),
  expires_at: z.string().optional(), http_status_code: z.number().int().optional(), quota: z.unknown().optional(),
});
const cacheList = z.object({ items: z.array(cachedItem) });
type Cached = z.infer<typeof cachedItem>;
type Row = z.infer<typeof rowSchema>;

export function cacheItems(value: unknown) {
  const parsed = cacheList.safeParse(value);
  if (!parsed.success) throw new Error("Keeper 返回的额度缓存格式有误。");
  return new Map(parsed.data.items.map(item => [item.auth_index, item]));
}

function instant(text?: string) {
  if (!text || !/(Z|[+-]\d\d:\d\d)$/.test(text)) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function windowFor(row: Row, observedAt: string): QuotaWindow {
  const seconds = row.window?.seconds;
  const feature = row.scope === "additional" && row.metric ? row.metric : row.key.replace(/\.(primary|secondary)_window$/, "");
  const used = row.usedPercent ?? null;
  let resetAt = instant(row.resetAt);
  if (!resetAt && row.resetAfterSeconds !== undefined) {
    const date = new Date(Date.parse(observedAt) + row.resetAfterSeconds * 1000);
    if (Number.isFinite(date.getTime())) resetAt = date.toISOString();
  }
  return {
    id: seconds ? `${row.scope ?? "quota"}/${encodeURIComponent(feature)}/${seconds}s` : row.key,
    label: row.label || row.key, durationSeconds: seconds, usedPercent: used, resetAt,
    status: used === null ? undefined : used >= 100 ? "exhausted" : "allowed",
  };
}

export function accountFromCache(identity: Identity, cache?: Cached): Account {
  // Both the Keeper row and the credential index precede any display-name or alias edits.
  const binding = JSON.stringify([identity.id, identity.identity]);
  const enabled = typeof identity.disabled === "boolean" ? !identity.disabled : null;
  const account: Account = {
    id: createHash("sha256").update(binding).digest("hex"),
    label: identity.displayName || identity.name,
    planLabel: identity.subscription?.provider === "codex" ? identity.subscription.plan : undefined,
    enabled, state: enabled === false ? "disabled" : "unknown", windows: [], observedAt: null,
  };
  if (!cache || (cache.expires_at && Date.parse(cache.expires_at) <= Date.now())) return account;
  if (cache.status === "failed") {
    const status = cache.http_status_code;
    return { ...account, state: enabled === false ? "disabled" : "unavailable",
      error: status ? `Keeper 上次采集此账号额度失败（HTTP ${status}）。` : "Keeper 上次采集此账号额度失败。" };
  }
  const result = cachedQuota.safeParse(cache.quota);
  const observedAt = instant(cache.refreshed_at);
  if (!result.success || result.data.id !== identity.identity || !observedAt) {
    return { ...account, error: "此账号的额度缓存记录无效。" };
  }
  const rows = result.data.quota ?? [];
  const main = rows.filter(row => row.scope === "window");
  const exhausted = main.some(row => row.limitReached || row.allowed === false || row.usedPercent === 100);
  if (enabled !== false) {
    if (exhausted) account.state = "exhausted";
    else if (main.some(row => row.allowed === true || row.usedPercent != null)) account.state = "available";
  }
  if (result.data.subscription?.provider === "codex") account.planLabel = result.data.subscription.plan;
  account.windows = rows.map(row => windowFor(row, observedAt));
  if (account.windows.some(window => window.usedPercent !== null || window.resetAt !== null) ||
      main.some(row => row.allowed != null || row.limitReached != null)) {
    account.observedAt = observedAt;
  }
  return account;
}
