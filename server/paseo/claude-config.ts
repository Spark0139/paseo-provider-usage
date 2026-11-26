import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";

type Providers = MutableDaemonConfig["providers"];

export function listClaudeProviders(providers: Providers) {
  const candidates = [{ id: "claude", label: "Claude" }, ...Object.entries(providers)
    .filter(([id, profile]) => id !== "claude" && profile.extends === "claude")
    .map(([id, profile]) => ({ id, label: typeof profile.label === "string" ? profile.label : id }))];
  return candidates.filter(({ id }) => providers[id]?.enabled !== false);
}

export function claudeCommand(providers: Providers, selected: string) {
  if (!listClaudeProviders(providers).some(({ id }) => id === selected)) return null;
  // Claude profiles inherit the built-in Provider's command unless they replace it.
  const command = providers[selected]?.command ?? providers.claude?.command;
  return Array.isArray(command) && command.every((arg): arg is string => typeof arg === "string") ? command : [];
}
