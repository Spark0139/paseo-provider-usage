import { z } from "zod";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { hashAccountKey, unavailable, windowFromUsedPct, type UsageReport } from "@getpaseo/plugin/server/usage";
import type { Account, SourceSnapshot } from "../../shared/types";
import { cpaIdentity, type UsageService } from "../usage/service";

const locator = z.object({ source: z.string(), account: z.string(), binding: z.string() }).strict();

export function reportFor(snapshot: SourceSnapshot, account: Account): UsageReport {
  if (account.enabled === false) return unavailable({ kind: "no_quota", detail: "Account disabled in CPA." });
  const error = snapshot.error ?? account.error;
  if (!account.observedAt) {
    return error ? { status: "error", error } : unavailable({ kind: "no_quota", detail: "Awaiting a quota reading." });
  }
  return {
    status: "available", observedAt: account.observedAt, planLabel: account.planLabel,
    windows: account.windows.map(window => windowFromUsedPct({
      id: window.id, label: window.label, utilizationPct: window.usedPercent,
      resetsAt: window.resetAt, durationSeconds: window.durationSeconds, summary: true,
    })),
    details: [
      { id: "state", label: "Account", value: account.state },
      ...(error ? [{ id: "refresh", label: "Latest refresh", value: error, tone: "warning" as const }] : []),
    ],
  };
}

export function registerUsage(server: Pick<PluginServerContext, "registerUsageSource">, usage: UsageService) {
  for (const kind of ["cpa", "claude"] as const) {
    server.registerUsageSource({
      id: kind === "cpa" ? "cpa-codex-quota" : "claude-passive-quota",
      label: kind === "cpa" ? "CPA · Codex" : "Claude Code · SDK",
      input: locator,
      async discover(scope) {
        if (scope.kind !== "global") return [];
        const sources = kind === "cpa"
          ? await usage.cpaSources()
          : usage.store.claude.enabled ? [usage.claudeSnapshot()] : [];
        return sources.flatMap(source => {
          const instance = usage.store.instances.find(item => item.id === source.sourceId);
          if (kind === "cpa" && !instance) return [];
          const binding = instance ? hashAccountKey(cpaIdentity(instance)) : usage.store.claude.providerId;
          return source.accounts.map(account => ({
            key: hashAccountKey(JSON.stringify([source.sourceId, account.id])),
            label: kind === "cpa" ? `${source.label} · ${account.label}` : account.label,
            input: { source: source.sourceId, account: account.id, binding },
          }));
        });
      },
      async fetch(input) {
        const { source, account, binding } = locator.parse(input);
        const instance = usage.store.instances.find(item => item.id === source);
        if (kind === "cpa" && (!instance || hashAccountKey(cpaIdentity(instance)) !== binding)) {
          return unavailable({ kind: "no_quota", detail: "Account configuration has changed." });
        }
        const snapshot = kind === "cpa"
          ? instance && await usage.cpaSnapshot(instance)
          : usage.store.claude.enabled && usage.claudeSnapshot();
        const entry = snapshot && snapshot.sourceId === source && snapshot.accounts.find(item => item.id === account);
        if (!snapshot || !entry || (instance && !usage.isCurrent(instance))) return unavailable({ kind: "no_quota", detail: "Account is no longer configured." });
        return reportFor(snapshot, entry);
      },
    });
  }
}
