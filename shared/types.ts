import { z } from "zod";

export const windowSchema = z.object({
  id: z.string(), label: z.string(), usedPercent: z.number().min(0).max(100).nullable(),
  resetAt: z.string().nullable(), status: z.string().optional(), durationSeconds: z.number().positive().optional(),
});
export const accountSchema = z.object({
  id: z.string(), label: z.string(), enabled: z.boolean().nullable(),
  state: z.enum(["available", "exhausted", "disabled", "unavailable", "unknown"]),
  planLabel: z.string().optional(), windows: z.array(windowSchema), observedAt: z.string().nullable(),
  error: z.string().optional(),
});
export const snapshotSchema = z.object({
  sourceId: z.string(), kind: z.enum(["cpa", "claude", "native"]), label: z.string(),
  accounts: z.array(accountSchema), lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(), error: z.string().optional(),
});
export const displaySchema = z.object({
  showDisabledAccounts: z.boolean(), showNativeProviders: z.boolean(), showResetCountdown: z.boolean(),
});
export const claudeSchema = z.object({
  enabled: z.boolean(), providerId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
});
export const instanceSchema = z.object({
  id: z.string().min(1), label: z.string().trim().min(1).max(100), baseUrl: z.string().min(1),
});
export type QuotaWindow = z.infer<typeof windowSchema>;
export type Account = z.infer<typeof accountSchema>;
export type SourceSnapshot = z.infer<typeof snapshotSchema>;
export type CpaInstance = z.infer<typeof instanceSchema>;
export type ClaudeSettings = z.infer<typeof claudeSchema>;
export type Display = z.infer<typeof displaySchema>;

export function enabledCount(accounts: Account[]) {
  return accounts.filter(account => account.enabled === true).length;
}
