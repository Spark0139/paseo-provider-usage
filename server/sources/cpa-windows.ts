import { z } from "zod";
import type { Account, QuotaWindow } from "../../shared/types";

const windowSchema = z.object({
  used_percent: z.number().min(0).max(100).nullish(),
  limit_window_seconds: z.number().int().positive().nullish(),
  reset_at: z.number().nonnegative().nullish(),
  reset_after_seconds: z.number().nonnegative().nullish(),
});
const limitSchema = z.object({
  allowed: z.boolean().nullish(),
  limit_reached: z.boolean().nullish(),
  primary_window: windowSchema.nullish(),
  secondary_window: windowSchema.nullish(),
});
const payloadSchema = z.object({
  plan_type: z.string().nullish(),
  rate_limit: limitSchema.nullish(),
  code_review_rate_limit: limitSchema.nullish(),
  additional_rate_limits: z.array(z.object({
    limit_name: z.string().nullish(),
    metered_feature: z.string().nullish(),
    rate_limit: limitSchema.nullish(),
  })).nullish(),
});

function period(duration: number | null | undefined, slot: "primary" | "secondary") {
  if (duration === 18000) return { id: "five_hour", label: "5-hour" };
  if (duration === 604800) return { id: "seven_day", label: "Weekly" };
  if (duration) {
    let label = `${duration}-second`;
    if (duration % 86400 === 0) label = `${duration / 86400}-day`;
    else if (duration % 3600 === 0) label = `${duration / 3600}-hour`;
    return { id: `duration-${duration}`, label };
  }
  return { id: slot, label: slot === "primary" ? "Primary window" : "Secondary window" };
}

function windowsFor(
  limit: z.infer<typeof limitSchema> | null | undefined,
  now: Date, prefix = "", groupLabel = "",
): QuotaWindow[] {
  if (!limit) return [];
  const windows: QuotaWindow[] = [];
  for (const slot of ["primary", "secondary"] as const) {
    const window = limit[`${slot}_window`];
    if (!window) continue;
    const { id, label } = period(window.limit_window_seconds, slot);
    const usedPercent = window.used_percent ?? null;
    let resetTime: number | undefined;
    if (window.reset_at != null) resetTime = window.reset_at * 1000;
    else if (window.reset_after_seconds != null) resetTime = now.getTime() + window.reset_after_seconds * 1000;
    const reset = new Date(resetTime ?? NaN);
    windows.push({
      id: prefix + id,
      label: groupLabel + label,
      usedPercent,
      resetAt: Number.isFinite(reset.getTime()) ? reset.toISOString() : null,
      durationSeconds: window.limit_window_seconds ?? undefined,
      status: usedPercent === null ? undefined : usedPercent === 100 ? "exhausted" : "allowed",
    });
  }
  return windows;
}

// Group-level flags describe the account. Only a window's own observation determines its percentage.
export function readQuota(value: unknown, now: Date): Pick<Account, "state" | "planLabel" | "windows"> | null {
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) return null;
  const { plan_type, rate_limit, code_review_rate_limit, additional_rate_limits } = parsed.data;
  const main = windowsFor(rate_limit, now);
  const windows = [...main, ...windowsFor(code_review_rate_limit, now, "review-", "Code review · ")];
  for (const extra of additional_rate_limits ?? []) {
    const feature = extra.metered_feature?.trim() || extra.limit_name?.trim();
    if (!feature) continue;
    const name = extra.limit_name?.trim() || feature;
    windows.push(...windowsFor(extra.rate_limit, now, `feature/${encodeURIComponent(feature)}/`, `${name} · `));
  }
  let state: Account["state"] = "unknown";
  if (rate_limit?.limit_reached || rate_limit?.allowed === false || main.some(w => w.usedPercent === 100)) {
    state = "exhausted";
  } else if (rate_limit?.allowed === true || main.some(w => w.usedPercent !== null)) {
    state = "available";
  }
  if (state === "unknown" && !windows.some(w => w.usedPercent !== null || w.resetAt !== null)) return null;
  return { state, planLabel: plan_type || undefined, windows };
}
