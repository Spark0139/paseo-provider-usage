import type { usePaseo } from "@getpaseo/plugin/client";
import type { Account, QuotaWindow, SourceSnapshot } from "../shared/types";

type ProviderList = Awaited<ReturnType<ReturnType<typeof usePaseo>["providers"]["listUsage"]>>;
type ProviderReport = ProviderList["providers"][number];

function nextId(counts: Map<string, number>, key: string): string {
  const occurrence = counts.get(key) ?? 0;
  counts.set(key, occurrence + 1);
  return `${occurrence}:${key}`;
}

function nativeAccount(report: ProviderReport, id: string): Account {
  const windowIds = new Map<string, number>();
  const windows: QuotaWindow[] = report.windows.map(window => ({
    // Bucket IDs can repeat across groups. The host includes the group in the full label.
    id: nextId(windowIds, JSON.stringify([window.id, window.label])),
    label: window.label,
    usedPercent: window.usedPct ?? (window.remainingPct == null ? null : 100 - window.remainingPct),
    resetAt: window.resetsAt ?? null, durationSeconds: window.durationSeconds,
  }));
  return {
    id, label: report.displayName, enabled: null,
    state: report.status === "available" ? "available" : "unavailable",
    planLabel: report.planLabel ?? undefined, observedAt: null,
    error: report.status === "error" ? "Paseo 原生查询失败" : undefined,
    windows,
  };
}

export function antigravitySnapshot(result: Pick<ProviderList, "providers">): SourceSnapshot {
  const reports = result.providers.filter(report => report.providerId === "antigravity");
  // listUsage exposes no account key. Equally named reports keep their own rows.
  const reportIds = new Map<string, number>();
  return {
    sourceId: "native-antigravity", kind: "native", label: "Antigravity",
    // The host-wide fetchedAt is the oldest report in the batch, not this account's observation.
    lastAttemptAt: null, lastSuccessAt: null,
    accounts: reports.map(report => nativeAccount(report, nextId(reportIds, report.displayName))),
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
