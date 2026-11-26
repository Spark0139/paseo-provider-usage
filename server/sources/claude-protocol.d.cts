import type { QuotaWindow } from "../../shared/types";
export const claudeWindowIds: readonly string[];
export function parseClaudeWindows(event: unknown): QuotaWindow[];
export function createClaudeProtocol(): {
  claudeWindowIds: typeof claudeWindowIds;
  parseClaudeWindows: typeof parseClaudeWindows;
};
