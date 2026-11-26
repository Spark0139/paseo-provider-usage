export const providers = {
  cpa: { id: "codex", label: "Codex" },
  claude: { id: "claude", label: "Claude" },
  native: { id: "antigravity", label: "Antigravity" },
} as const;

export type ProviderKind = keyof typeof providers;
