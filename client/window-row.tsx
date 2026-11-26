import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { QuotaWindow } from "../shared/types";
import { RemainingBar } from "./controls";
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

export function WindowRow({ window, label, theme, compact, now, showCountdown }: RowProps & { window: QuotaWindow; label: string }) {
  const c = theme.colors;
  const amount = remaining(window.usedPercent);
  const condition = window.status === "rejected" ? "已受限"
    : window.status === "exhausted" || window.usedPercent === 100 ? "已耗尽"
    : window.status === "allowed_warning" ? "接近限制" : null;
  const timing = window.resetAt
    ? <Timestamp iso={window.resetAt} now={now} label="重置" theme={theme} countdown={showCountdown} alignEnd={!compact} />
    : <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>重置 —</Text>;
  return <View style={{ paddingVertical: 5, gap: 2 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: compact ? 8 : 14 }}>
      <Text style={{ color: c.foreground, fontSize: 14, flex: 1 }}>{label}
        {condition && <Text style={{ color: c.statusWarning, fontSize: 12 }}>　{condition}</Text>}
      </Text>
      <View style={compact ? { width: 66 } : { flex: 1, minWidth: 66, maxWidth: 245 }}>
        {window.usedPercent != null && <RemainingBar used={window.usedPercent} theme={theme} />}
      </View>
      <Text accessibilityLabel={`剩余 ${amount}`} style={{ color: c.foreground, width: 54, textAlign: "right",
        fontVariant: ["tabular-nums"], fontSize: 16, fontWeight: "600" }}>{amount}</Text>
      {!compact && <View style={{ width: 233, alignItems: "flex-end" }}>{timing}</View>}
    </View>
    {compact && timing}
  </View>;
}
