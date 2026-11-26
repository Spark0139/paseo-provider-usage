import { createHash } from "node:crypto";
import type { Account, QuotaWindow } from "../../shared/types";
import { emptySnapshot, type SnapshotCache } from "../storage/snapshots";
import type { SettingsStore } from "../storage/store";
import type { UsageSource, UsageTarget } from "./source";

function mergeClaudeWindow(previous: QuotaWindow | undefined, window: QuotaWindow, observedAt: string): QuotaWindow {
  if (!previous || (window.resetAt && window.resetAt !== previous.resetAt) ||
      (previous.resetAt && Date.parse(previous.resetAt) <= Date.parse(observedAt))) return window;
  return { ...window, usedPercent: window.usedPercent ?? previous.usedPercent, resetAt: window.resetAt ?? previous.resetAt };
}

export class ClaudeUsage implements UsageSource {
  readonly kind = "claude";
  readonly registrationId = "claude-passive-quota";
  readonly sourceId = "claude-passive";

  constructor(private store: SettingsStore, private cache: SnapshotCache) {}

  get binding() {
    return createHash("sha256").update(this.store.claude.providerId).digest("hex");
  }

  targets(): UsageTarget[] {
    if (!this.store.claude.enabled) return [];
    const binding = this.binding;
    return [{
      id: this.sourceId, binding,
      current: () => this.store.claude.enabled && this.binding === binding,
      read: () => this.snapshot(),
    }];
  }

  snapshot() {
    const cached = this.cache.get(this.sourceId, this.binding);
    if (cached) return cached;
    const snapshot = emptySnapshot(this.kind, this.sourceId);
    snapshot.accounts.push({
      id: this.binding, label: snapshot.label, enabled: null, state: "unknown", windows: [], observedAt: null,
    });
    return snapshot;
  }

  ingest(windows: QuotaWindow[], observedAt: string) {
    if (!this.store.claude.enabled || !windows.length) return;
    const snapshot = this.snapshot();
    const previous = snapshot.accounts[0];
    if (previous.observedAt && Date.parse(observedAt) < Date.parse(previous.observedAt)) return;
    const merged = new Map(previous.windows.map(window => [window.id, window]));
    for (const window of windows) merged.set(window.id, mergeClaudeWindow(merged.get(window.id), window, observedAt));
    const latest = [...merged.values()];
    const general = latest.filter(window => window.id === "five_hour" || window.id === "seven_day");
    const exhausted = general.some(window => window.usedPercent === 100 || window.status === "rejected");
    const account: Account = { ...previous, observedAt, windows: latest,
      state: exhausted ? "exhausted" : general.length ? "available" : "unknown" };
    this.cache.save(this.binding, {
      ...snapshot, accounts: [account], lastAttemptAt: observedAt, lastSuccessAt: observedAt,
    });
  }
}
