import type { usePaseo } from "@getpaseo/plugin/client";
import type { SourceSnapshot } from "../shared/types";

type ProviderList = Awaited<ReturnType<ReturnType<typeof usePaseo>["providers"]["listUsage"]>>;

export function antigravitySnapshot(result: Pick<ProviderList, "providers">): SourceSnapshot {
  const reports = result.providers.filter(report => report.providerId === "antigravity");
  return {
    sourceId: "native-antigravity", kind: "native", label: "Antigravity",
    // The host-wide fetchedAt is the oldest report in the batch, not this account's observation.
    lastAttemptAt: null, lastSuccessAt: null,
    accounts: reports.map((report, index) => ({
      // listUsage exposes no account key. Ordinals distinguish reports only within this response.
      id: `${report.displayName}-${index}`, label: report.displayName,
      enabled: null, state: report.status === "available" ? "available" : "unavailable",
      planLabel: report.planLabel ?? undefined, observedAt: null,
      error: report.status === "error" ? "Paseo 原生查询失败" : undefined,
      windows: report.windows.map(window => ({
        id: window.id, label: window.label,
        usedPercent: window.usedPct ?? (window.remainingPct == null ? null : 100 - window.remainingPct),
        resetAt: window.resetsAt ?? null, durationSeconds: window.durationSeconds,
      })),
    })),
  };
}

export function localDate(iso: string, locale?: string, timeZone?: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone,
  }).format(date);
}

export function countdown(iso: string, now: number): string {
  const minutes = Math.ceil((Date.parse(iso) - now) / 60_000);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes <= 0) return "重置时间已过";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days} 天 ${hours} 小时后`;
  if (hours) return `${hours} 小时 ${minutes % 60} 分钟后`;
  return `${minutes} 分钟后`;
}
