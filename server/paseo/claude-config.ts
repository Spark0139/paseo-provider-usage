import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import { basename } from "node:path";

export function claudeProviderSetup(providers: MutableDaemonConfig["providers"], selected: string) {
  // Paseo 0.17.4 uses an explicit command override or inherits the base provider's command.
  const candidates = [{ id: "claude", label: "Claude" }, ...Object.entries(providers)
    .filter(([id, profile]) => id !== "claude" && profile.extends === "claude")
    .map(([id, profile]) => ({ id, label: typeof profile.label === "string" ? profile.label : id }))];
  const available = candidates.filter(({ id }) => providers[id]?.enabled !== false);
  if (!available.some(({ id }) => id === selected)) return { providers: available, launcher: "unknown" as const };
  const command = providers[selected]?.command ?? providers.claude?.command;
  // A shell script may invoke the collector internally. Only the live handshake confirms execution.
  const listed = Array.isArray(command) && command.some(arg => typeof arg === "string" && basename(arg) === "claude-launch.cjs");
  return { providers: available, launcher: listed ? "listed" as const : "unlisted" as const };
}
