import type { ProviderUsage } from "@getpaseo/protocol/messages";
import type { Account, QuotaWindow, SourceSnapshot } from "./types";

function nextId(counts: Map<string, number>, key: string): string {
  const occurrence = counts.get(key) ?? 0;
  counts.set(key, occurrence + 1);
  return `${occurrence}:${key}`;
}

function nativeAccount(report: ProviderUsage, id: string): Account {
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

export function antigravitySnapshot(result: { providers: ProviderUsage[] }): SourceSnapshot {
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
