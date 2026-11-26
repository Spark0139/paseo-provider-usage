import { z } from "zod";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { hashAccountKey, unavailable, windowFromUsedPct, type UsageReport } from "@getpaseo/plugin/server/usage";
import type { Account, SourceSnapshot } from "../../shared/types";
import { providers } from "../../shared/providers";
import { readTargets, type UsageSource } from "../usage/source";

const locator = z.object({ source: z.string(), account: z.string(), binding: z.string() }).strict();

export function reportFor(snapshot: SourceSnapshot, account: Account): UsageReport {
  if (account.enabled === false) return unavailable({ kind: "no_quota", detail: "Account disabled in Keeper." });
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

export function registerUsage(server: Pick<PluginServerContext, "registerUsageSource">, sources: readonly UsageSource[]) {
  for (const source of sources) {
    server.registerUsageSource({
      id: source.registrationId,
      label: providers[source.kind].label,
      input: locator,
      async discover(scope) {
        if (scope.kind !== "global") return [];
        const readings = await readTargets(source.targets());
        return readings.flatMap(({ target, snapshot }) => snapshot.accounts.map(account => ({
          key: hashAccountKey(JSON.stringify([target.id, account.id])),
          label: account.label === snapshot.label ? undefined : account.label,
          input: { source: target.id, account: account.id, binding: target.binding },
        })));
      },
      async fetch(input) {
        const { source: id, account, binding } = locator.parse(input);
        const target = source.targets().find(target => target.id === id && target.binding === binding);
        const snapshot = await target?.read();
        const entry = snapshot?.accounts.find(item => item.id === account);
        if (!snapshot || !entry || !target?.current()) {
          return unavailable({ kind: "no_quota", detail: "Account is no longer configured." });
        }
        return reportFor(snapshot, entry);
      },
    });
  }
}
