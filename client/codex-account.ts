import type { Account, CodexAccountRef, QuotaWindow, SourceSnapshot } from "../shared/types";

const fiveHours = 18_000;
const week = 604_800;

function mainWindow(account: Account) {
  // Keeper separates the normal subscription from Code Review and additional feature limits.
  // Without a duration the adapter retains Keeper's original primary/secondary key.
  const windows = account.windows.filter(w => w.usedPercent !== null &&
    (w.id.startsWith("window/rate_limit/") || w.id === "rate_limit.primary_window" || w.id === "rate_limit.secondary_window"));
  return windows.find(w => w.durationSeconds === fiveHours) ?? windows.find(w => w.durationSeconds === week) ?? windows[0];
}

export function codexPeriod(window: QuotaWindow) {
  const seconds = window.durationSeconds;
  if (!seconds) return window.id === "rate_limit.primary_window" ? "主窗口" : "次窗口";
  if (window.label === "Monthly") return "月额度";
  if (seconds % 86_400 === 0) return `${seconds / 86_400}天`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}分`;
  return `${seconds}秒`;
}

export function accountKey(ref: CodexAccountRef) {
  return JSON.stringify([ref.sourceId, ref.accountId]);
}

export function codexAccounts(sources: SourceSnapshot[]) {
  return sources.filter(source => source.kind === "cpa").flatMap(source => source.accounts.map(account => {
    const ref = { sourceId: source.sourceId, accountId: account.id };
    const current = !source.error && (account.state === "available" || account.state === "exhausted");
    return { key: accountKey(ref), ref, label: `${source.instanceLabel ?? source.label} · ${account.label}`,
      account, window: account.enabled === true && current ? mainWindow(account) : undefined };
  }));
}

export function displayedCodexAccount(accounts: ReturnType<typeof codexAccounts>, preferred: CodexAccountRef | null) {
  if (preferred) return accounts.find(row => row.key === accountKey(preferred));
  const enabled = accounts.filter(row => row.account.enabled === true).sort((a, b) => a.key.localeCompare(b.key));
  return enabled.find(row => row.window && row.account.state === "available") ?? enabled.find(row => row.window) ?? enabled[0];
}
