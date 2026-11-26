import type { ProviderUsage } from "@getpaseo/protocol/messages";
import { providers } from "./providers";
import type { Account, QuotaWindow, SourceSnapshot } from "./types";

function nextId(counts: Map<string, number>, key: string): string {
  const occurrence = counts.get(key) ?? 0;
  counts.set(key, occurrence + 1);
  return `${occurrence}:${key}`;
}

function poolFamily(name: string): string {
  if (/^gemini\b/i.test(name)) return "Gemini";
  if (/^claude\s*(?:and|&|\/)\s*gpt\b/i.test(name)) return "Claude / GPT";
  if (/^claude\b/i.test(name)) return "Claude";
  if (/^gpt\b/i.test(name)) return "GPT";
  return name ? "额度组" : "";
}

const periods = new Map([
  ["5h", "5 小时"], ["weekly", "7 天"], ["wk", "7 天"], ["daily", "每日"], ["day", "每日"], ["monthly", "每月"], ["mo", "每月"],
]);
const units = new Map([["s", "秒"], ["m", "分钟"], ["h", "小时"], ["d", "天"], ["w", "周"]]);

function periodLabel(shortLabel: string | undefined, bucket: string, duration?: number): string {
  const short = shortLabel?.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  const named = periods.get(short) ?? periods.get(bucket.toLowerCase());
  if (named) return named;
  const numeric = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(short);
  if (numeric) return `${numeric[1]} ${units.get(numeric[2])}`;
  return duration ? `${duration} 秒` : "额度窗口";
}

function nativeWindows(windows: ProviderUsage["windows"]): QuotaWindow[] {
  const ids = new Map<string, number>();
  const rows = windows.map(window => {
    // agy supplies a group and a bucket; Paseo joins their names and the optional Disabled suffix.
    const parts = window.label.split(" · ");
    const disabled = parts.at(-1) === "Disabled";
    if (disabled) parts.pop();
    const bucket = parts.pop() ?? "";
    const group = parts.join(" · ");
    const period = periodLabel(window.shortLabel, bucket, window.durationSeconds);
    const key = nextId(ids, JSON.stringify([window.id, window.label]));
    return { window, group, period, disabled, key };
  });

  // Number distinct host groups in a stable order without displaying the private model labels.
  const names = new Map<string, string>();
  const groups = [...new Set(rows.map(row => row.group))].sort();
  for (const group of groups) {
    const family = poolFamily(group);
    const siblings = groups.filter(candidate => poolFamily(candidate) === family);
    const prefix = family === "额度组" ? family : `${family} 额度组`;
    names.set(group, siblings.length > 1 || family === "额度组" ? `${prefix} ${siblings.indexOf(group) + 1}` : family);
  }

  return rows.map(({ window, group, period, disabled, key }) => {
    let label = period;
    // The host can also give two distinct buckets in one group the same period and display name.
    const peers = rows.filter(row => row.group === group && row.period === period);
    if (peers.length > 1) {
      const keys = peers.map(row => row.key).sort();
      label += ` · 窗口 ${keys.indexOf(key) + 1}`;
    }
    return {
      id: key, label, groupLabel: names.get(group) || undefined,
      usedPercent: window.usedPct ?? (window.remainingPct == null ? null : 100 - window.remainingPct),
      resetAt: window.resetsAt ?? null, durationSeconds: window.durationSeconds,
      ...(disabled ? { status: "disabled" } : {}),
    };
  });
}

function nativeAccount(report: ProviderUsage, id: string): Account {
  return {
    id, label: report.displayName, enabled: null,
    state: report.status === "available" ? "available" : "unavailable",
    planLabel: report.planLabel ?? undefined, observedAt: null,
    error: report.status === "error" ? "读取额度失败" : undefined,
    windows: nativeWindows(report.windows),
  };
}

export function antigravitySnapshot(result: { providers: ProviderUsage[] }): SourceSnapshot {
  const product = providers.native;
  const reports = result.providers.filter(report => report.providerId === product.id);
  // listUsage exposes no account key. Equally named reports keep their own rows.
  const reportIds = new Map<string, number>();
  return {
    sourceId: "native-antigravity", kind: "native", label: product.label,
    // The host-wide fetchedAt is the oldest report in the batch, not this account's observation.
    lastAttemptAt: null, lastSuccessAt: null,
    accounts: reports.map(report => nativeAccount(report, nextId(reportIds, report.displayName))),
  };
}
