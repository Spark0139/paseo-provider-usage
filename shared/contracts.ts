import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { claudeSchema, displaySchema, instanceSchema, snapshotSchema } from "./types";

const empty = z.object({});
export const settingsSchema = z.object({
  instances: z.array(instanceSchema.extend({ hasSecret: z.boolean() })),
  claude: claudeSchema, display: displaySchema, claudeObservedAt: z.string().nullable(),
});
export type SettingsView = z.infer<typeof settingsSchema>;
export const overviewRpc = defineRpc({
  name: "usage.overview", input: z.object({ refresh: z.boolean().optional() }),
  output: z.object({ sources: z.array(snapshotSchema), display: displaySchema, mock: z.boolean() }),
});
export const settingsRpc = defineRpc({ name: "config.read", input: empty, output: settingsSchema });
const instanceDraft = instanceSchema.partial({ id: true }).extend({ key: z.string().optional() });
export const saveInstanceRpc = defineRpc({ name: "instance.save", input: instanceDraft, output: settingsSchema });
export const testInstanceRpc = defineRpc({
  name: "instance.test", input: instanceDraft, output: z.object({ count: z.number().int().nonnegative() }),
});
export const deleteInstanceRpc = defineRpc({ name: "instance.delete", input: z.object({ id: z.string() }), output: settingsSchema });
export const clearSecretRpc = defineRpc({ name: "instance.clear-key", input: z.object({ id: z.string() }), output: settingsSchema });
export const preferencesRpc = defineRpc({
  name: "config.preferences", input: z.object({ claude: claudeSchema.optional(), display: displaySchema.partial().optional() }),
  output: settingsSchema,
});
