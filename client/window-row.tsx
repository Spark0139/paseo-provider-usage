import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { QuotaWindow } from "../shared/types";
import { clampPercent, UsageMeter } from "./controls";
import { Timestamp } from "./timestamp";

const knownLabels = new Map([
  ["5h", "5 小时"], ["5-hour", "5 小时"], ["weekly", "7 天"], ["monthly", "月额度"], ["daily", "日额度"], ["disabled", "已停用"],
]);

export function windowLabel(window: QuotaWindow) {
  if (window.id === "seven_day_overage_included") return "Fable 周额度";
  return knownLabels.get(window.label.toLowerCase()) ?? window.label;
}

export function remaining(used: number | null) {
  return used == null ? "—" : `${Number((100 - used).toFixed(1))}%`;
}

export type RowProps = { theme: PluginTheme; compact: boolean; now: number; showCountdown: boolean };

// Usage Monitor's quotaPacePercent, expressed in the same direction as our remaining bar.
function remainingPace(window: QuotaWindow, now: number) {
  if (!window.resetAt || !window.durationSeconds) return null;
  const resetsAt = Date.parse(window.resetAt);
  if (!Number.isFinite(resetsAt) || resetsAt <= now) return null;
  return clampPercent((resetsAt - now) / (window.durationSeconds * 1000) * 100);
}

// Adapted from QuotaRow. Keep its title/value header, full-width meter and reset hint.
export function WindowRow({ window, theme, compact, now, showCountdown }: RowProps & { window: QuotaWindow }) {
  const c = theme.colors;
  const smallFontSize = compact ? 11 : 12;
  const valueLabel = window.usedPercent == null ? "—" : `${remaining(window.usedPercent)} 剩余`;
  const qualifier = window.status === "disabled" ? "已停用"
    : window.status === "rejected" ? "已受限"
    : window.status === "exhausted" || window.usedPercent === 100 ? "已耗尽"
    : window.status === "allowed_warning" ? "接近限制" : null;
  return <View style={{ gap: 4 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, flexGrow: 1, flexShrink: 1 }}>
        <Text style={{ color: c.foreground, fontSize: compact ? 13 : 14, flexShrink: 1 }}>{windowLabel(window)}</Text>
        {qualifier && <Text style={{ color: window.status === "disabled" ? c.foregroundMuted : c.statusWarning, fontSize: smallFontSize }}>
          {qualifier}
        </Text>}
      </View>
      <Text style={{ color: c.foregroundMuted, fontSize: smallFontSize, textAlign: "right", fontVariant: ["tabular-nums"] }}>{valueLabel}</Text>
    </View>
    {window.usedPercent !== null && <UsageMeter percentUsed={window.usedPercent} percentFilled={100 - window.usedPercent}
      pacePercent={remainingPace(window, now)} theme={theme} compact={compact} />}
    {window.resetAt && <Timestamp iso={window.resetAt} now={now} label="重置" theme={theme} countdown={showCountdown} />}
  </View>;
}

type ReadingGroup = { label: string | null; readings: QuotaWindow[] };

// Adapted from groupReadings and ReadingGroups in Usage Monitor's limits.client.tsx.
function groupReadings(readings: QuotaWindow[]) {
  const ungrouped: QuotaWindow[] = [];
  const labelled = new Map<string, ReadingGroup>();
  for (const reading of readings) {
    if (!reading.groupLabel) {
      ungrouped.push(reading);
      continue;
    }
    const existing = labelled.get(reading.groupLabel);
    if (existing) existing.readings.push(reading);
    else labelled.set(reading.groupLabel, { label: reading.groupLabel, readings: [reading] });
  }
  const groups = [...labelled.values()];
  if (ungrouped.length) groups.unshift({ label: null, readings: ungrouped });
  return groups;
}

export function ReadingGroups({ windows, ...row }: RowProps & { windows: QuotaWindow[] }) {
  const gap = row.compact ? 8 : 12;
  return <View style={{ gap }}>
    {groupReadings(windows).map(group => <View key={group.label === null ? "ungrouped" : `group:${group.label}`} style={{ gap }}>
      {group.label && <Text accessibilityRole="header" style={{ color: row.theme.colors.foregroundMuted, fontSize: row.compact ? 11 : 12,
        fontWeight: "600" }}>{group.label}</Text>}
      {group.readings.map(window => <WindowRow key={window.id} window={window} {...row} />)}
    </View>)}
  </View>;
}
