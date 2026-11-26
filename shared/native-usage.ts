import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { CompactProviderSnapshot } from "@getpaseo/protocol/provider-snapshot-codec";
import type { ProviderUsage } from "@getpaseo/protocol/messages";
import { providers } from "./providers";
import type { Account, QuotaWindow, SourceSnapshot } from "./types";

function nextId(counts: Map<string, number>, key: string): string {
  const occurrence = counts.get(key) ?? 0;
  counts.set(key, occurrence + 1);
  return `${occurrence}:${key}`;
}

function windowName(window: ProviderUsage["windows"][number]) {
  // agy's paid Argon bucket is separate, even when the CLI labels its group simply "Gemini".
  if (window.id === "gemini-argon-wtu-weekly" && /^(?:Gemini · )?Weekly(?: · Disabled)?$/i.test(window.label)) {
    return "Gemini 4 Argon · " + window.label.replace(/^Gemini · /i, "");
  }
  return window.label;
}

function nativeAccount(report: ProviderUsage, id: string): Account {
  const windowIds = new Map<string, number>();
  const windows: QuotaWindow[] = report.windows.map(window => ({
    // Bucket IDs can repeat across groups. The host includes the group in the full label.
    id: nextId(windowIds, JSON.stringify([window.id, window.label])),
    label: windowName(window),
    usedPercent: window.usedPct ?? (window.remainingPct == null ? null : 100 - window.remainingPct),
    resetAt: window.resetsAt ?? null, durationSeconds: window.durationSeconds,
  }));
  return {
    id, label: report.displayName, enabled: null,
    state: report.status === "available" ? "available" : "unavailable",
    planLabel: report.planLabel ?? undefined, observedAt: null,
    error: report.status === "error" ? "读取额度失败" : undefined,
    windows,
  };
}

type Catalog = { entries: ProviderSnapshotEntry[]; compactSnapshot?: CompactProviderSnapshot };

export function antigravitySnapshot(result: { providers: ProviderUsage[] }, catalog?: Catalog): SourceSnapshot {
  const product = providers.native;
  const reports = result.providers.filter(report => report.providerId === product.id);
  // App clients receive the wire snapshot. Its models inherit the provider ID from their entry.
  const entries = catalog?.compactSnapshot?.entries ?? catalog?.entries;
  const entry = entries?.find(entry => entry.provider === product.id && entry.enabled);
  const models = entry?.models?.filter(model => model.isSelectable !== false &&
    (!("provider" in model) || model.provider === product.id))
    .map(({ id, label }) => ({ id, label }));
  // listUsage exposes no account key. Equally named reports keep their own rows.
  const reportIds = new Map<string, number>();
  return {
    sourceId: "native-antigravity", kind: "native", label: product.label,
    ...(models?.length ? { models } : {}),
    // The host-wide fetchedAt is the oldest report in the batch, not this account's observation.
    lastAttemptAt: null, lastSuccessAt: null,
    accounts: reports.map(report => nativeAccount(report, nextId(reportIds, report.displayName))),
  };
}
