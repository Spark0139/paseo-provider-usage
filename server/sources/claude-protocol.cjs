// This module runs in the plugin and the standalone Node launcher.
const fableWindowId = "seven_day_overage_included";
const windowDefinitions = [
  ["five_hour", "5-hour", 5 * 3600],
  ["seven_day", "Weekly", 7 * 24 * 3600],
  [fableWindowId, "Fable 周额度", 7 * 24 * 3600],
];
const claudeWindowIds = windowDefinitions.map(([id]) => id);
const statuses = new Set(["allowed", "allowed_warning", "rejected"]);

function parseClaudeWindows(event) {
  if (event?.type !== "rate_limit_event" || !event.rate_limit_info) return [];
  const info = event.rate_limit_info;
  const windows = [];
  for (const [id, label, durationSeconds] of windowDefinitions) {
    const entry = info.unifiedWindows?.[id];
    const selected = info.rateLimitType === id ? info : undefined;
    const used = entry?.utilization ?? selected?.utilization;
    if (used !== undefined && (!Number.isFinite(used) || used < 0 || used > 1)) continue;
    const epoch = entry?.resetsAt ?? selected?.resetsAt;
    const date = Number.isFinite(epoch) && epoch >= 0 ? new Date(epoch * 1000) : null;
    const resetAt = date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
    const status = entry?.status ?? selected?.status;
    // The SDK can identify the Fable limit that triggered an event without sending a percentage.
    const partialFable = id === fableWindowId && selected && (resetAt !== null || statuses.has(status));
    if (used === undefined && !partialFable) continue;
    windows.push({
      id, label, durationSeconds, resetAt,
      usedPercent: used === undefined ? null : Math.round(used * 10000) / 100,
      ...(statuses.has(status) ? {status} : {}),
    });
  }
  return windows;
}

module.exports = {claudeWindowIds, parseClaudeWindows};
