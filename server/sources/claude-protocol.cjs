// This module runs in the plugin and the standalone Node launcher.
const windowDefinitions = [
  ["five_hour", "5-hour", 5 * 3600],
  ["seven_day", "Weekly", 7 * 24 * 3600],
];
const statuses = new Set(["allowed", "allowed_warning", "rejected"]);

function parseClaudeWindows(event) {
  if (event?.type !== "rate_limit_event" || !event.rate_limit_info) return [];
  const info = event.rate_limit_info;
  const windows = [];
  for (const [id, label, durationSeconds] of windowDefinitions) {
    const data = info.unifiedWindows?.[id] ?? (info.rateLimitType === id ? info : null);
    const used = data?.utilization;
    if (!Number.isFinite(used) || used < 0 || used > 1) continue;
    const epoch = data.resetsAt;
    const date = Number.isFinite(epoch) && epoch >= 0 ? new Date(epoch * 1000) : null;
    windows.push({
      id, label, durationSeconds,
      usedPercent: Math.round(used * 10000) / 100,
      resetAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
      ...(statuses.has(data.status) ? {status: data.status} : {}),
    });
  }
  return windows;
}

module.exports = {parseClaudeWindows};
