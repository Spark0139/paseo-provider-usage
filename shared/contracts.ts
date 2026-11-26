import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { claudeSchema, codexAccountSchema, displaySchema, instanceSchema, snapshotSchema } from "./types";

const empty = z.object({});
export const settingsSchema = z.object({
  codexAccount: codexAccountSchema.nullable(),
  instances: z.array(instanceSchema.extend({ hasPassword: z.boolean() })),
  claude: claudeSchema, display: displaySchema, claudeObservedAt: z.string().nullable(),
});
export type SettingsView = z.infer<typeof settingsSchema>;
export const overviewRpc = defineRpc({
  name: "usage.overview", input: z.object({ refresh: z.boolean().optional() }),
  output: z.object({ sources: z.array(snapshotSchema), display: displaySchema, codexAccount: codexAccountSchema.nullable(), mock: z.boolean() }),
});
export const settingsRpc = defineRpc({ name: "config.read", input: empty, output: settingsSchema });
const instanceDraft = instanceSchema.partial({ id: true }).extend({ password: z.string().optional() }).strict();
export const saveInstanceRpc = defineRpc({ name: "keeper.save", input: instanceDraft, output: settingsSchema });
export const testInstanceRpc = defineRpc({
  name: "keeper.test", input: instanceDraft, output: z.object({ count: z.number().int().nonnegative() }),
});
export const deleteInstanceRpc = defineRpc({ name: "keeper.delete", input: z.object({ id: z.string() }), output: settingsSchema });
export const clearSecretRpc = defineRpc({ name: "keeper.clear-password", input: z.object({ id: z.string() }), output: settingsSchema });
const count = z.number().int().nonnegative();
const refreshResult = z.object({ queued: count, pending: count, failed: count });
export type KeeperRefreshResult = z.infer<typeof refreshResult>;
export const refreshKeeperRpc = defineRpc({
  name: "keeper.refresh", input: z.object({ id: z.string() }),
  output: refreshResult,
});
const refreshStatus = z.object({
  phase: z.enum(["idle", "pending", "completed", "unconfirmed"]),
  completed: count, failed: count, remaining: count, error: z.string().optional(),
});
export type KeeperRefreshStatus = z.infer<typeof refreshStatus>;
export const keeperRefreshStatusRpc = defineRpc({
  name: "keeper.refresh.status", input: z.object({ id: z.string() }), output: refreshStatus,
});

export const claudeDiagnosticsRpc = defineRpc({
  name: "claude.diagnostics", input: empty,
  output: z.object({
    providers: z.array(z.object({ id: z.string(), label: z.string() })),
    launcher: z.enum(["listed", "unlisted", "unknown"]),
    stage: z.enum(["disabled", "waitingSession", "sessionOpened", "connected", "observed", "receiverError"]),
    observedAt: z.string().nullable(),
  }),
});

export const preferencesRpc = defineRpc({
  name: "config.preferences", input: z.object({ codexAccount: codexAccountSchema.nullable().optional(), claude: claudeSchema.optional(), display: displaySchema.partial().optional() }),
  output: settingsSchema,
});
