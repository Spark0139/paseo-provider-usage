import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Account, QuotaWindow, SourceSnapshot } from "../shared/types";
import { RemainingBar } from "./controls";
import { Timestamp } from "./timestamp";

const knownLabels = new Map([
  ["5h", "5 小时"], ["5-hour", "5 小时"], ["weekly", "7 天"], ["monthly", "月额度"], ["daily", "日额度"], ["disabled", "已停用"],
]);

function windowLabel(window: QuotaWindow) {
  if (window.id === "seven_day_overage_included") return "Fable 周额度";
  return knownLabels.get(window.label.toLowerCase()) ?? window.label;
}

function remaining(used: number | null) {
  return used == null ? "—" : `${Number((100 - used).toFixed(1))}%`;
}

type RowProps = { theme: PluginTheme; compact: boolean; now: number; showCountdown: boolean };

function WindowRow({ window, label, theme, compact, now, showCountdown }: RowProps & { window: QuotaWindow; label: string }) {
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

function WindowList({ windows, native, ...row }: RowProps & { windows: QuotaWindow[]; native: boolean }) {
  const groups = new Map<string, { window: QuotaWindow; label: string }[]>();
  for (const window of windows) {
    // The host appends a period and optionally Disabled. Keep its entire model/group name.
    const match = native ? /^(.+) · (5h|Daily|Weekly|Monthly)( · Disabled)?$/i.exec(window.label) : null;
    const group = match?.[1] ?? "";
    const period = match ? knownLabels.get(match[2].toLowerCase()) : undefined;
    const label = match && period ? period + (match[3] ? " · 已停用" : "") : windowLabel(window);
    let entries = groups.get(group);
    if (!entries) { entries = []; groups.set(group, entries); }
    entries.push({ window, label });
  }
  return [...groups].map(([group, entries], index) => <View key={group}
    style={{ borderTopWidth: group && index > 0 ? 1 : 0, borderColor: row.theme.colors.border }}>
    {group.length > 0 && <Text accessibilityRole="header" style={{ color: row.theme.colors.foreground, fontSize: 13,
      fontWeight: "600", paddingTop: 5 }}>{group}</Text>}
    {entries.map(entry => <WindowRow key={entry.window.id} {...entry} {...row} />)}
  </View>);
}

const stateLabels = {
  available: "可用", exhausted: "额度耗尽", disabled: "已停用", unavailable: "额度不可用", unknown: "额度未知",
};

function AccountState({ account, keeper, theme }: { account: Account; keeper: boolean; theme: PluginTheme }) {
  const labels = [account.planLabel];
  if (keeper) labels.push(account.enabled === null ? "启用状态未知" : account.enabled ? "已启用" : "已停用");
  const status = (!keeper || (account.state !== "available" && account.state !== "disabled"))
    ? stateLabels[account.state] : null;
  const note = labels.filter(Boolean).join(" · ");
  const warning = account.state === "exhausted" || account.state === "unavailable";
  return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
    {note}{note && status ? " · " : ""}{status && <Text style={{ color: warning ? theme.colors.statusWarning : undefined }}>{status}</Text>}
  </Text>;
}

type AccountProps = RowProps & {
  account: Account; kind: SourceSnapshot["kind"]; sourceLabel: string; initialOpen: boolean; singleReport: boolean;
};

export function AccountRows({ account, kind, sourceLabel, initialOpen, singleReport, ...row }: AccountProps) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const { theme, compact, now } = row;
  const c = theme.colors;
  const open = singleReport || (expanded ?? initialOpen);
  const windows = account.windows;
  const preview = windows.slice(0, 2).map(w => `${windowLabel(w)} ${remaining(w.usedPercent)}`).join("   ");
  const state = <AccountState account={account} keeper={kind === "cpa"} theme={theme} />;
  return <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingHorizontal: compact ? 12 : 16,
    paddingVertical: singleReport ? 8 : 4 }}>
    {singleReport
      ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {account.label !== sourceLabel && <Text style={{ color: c.foreground, fontWeight: "500" }}>{account.label}</Text>}
        {(account.planLabel || account.state !== "available") && state}
      </View>
      : <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setExpanded(!open)}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7 }}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={c.foregroundMuted} />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "600", flexShrink: 1 }}>{account.label}</Text>
          {state}
          {!open && windows.length > 0 && <Text style={{ color: c.foreground, fontSize: 12,
            fontVariant: ["tabular-nums"], marginLeft: compact ? 0 : "auto" }}>
            {preview}{windows.length > 2 ? ` 等 ${windows.length} 项` : ""}
          </Text>}
        </View>
      </Pressable>}
    {account.error && <Text style={{ color: c.statusWarning, fontSize: 13, paddingVertical: 3 }}>{account.error}</Text>}
    {open && <View style={{ paddingBottom: singleReport ? 0 : 6 }}>
      <WindowList windows={windows} native={kind === "native"} {...row} />
      {!windows.length && !account.error && <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>
        {kind === "claude" ? "等待首次额度事件" : "暂无额度窗口"}
      </Text>}
      {kind === "claude" && windows.length > 0 && !windows.some(w => w.id === "seven_day_overage_included") &&
        <Text style={{ color: c.foregroundMuted, fontSize: 12, paddingVertical: 3 }}>尚未收到 Fable 额度</Text>}
      {account.observedAt && <Timestamp label="最近观测" iso={account.observedAt} now={now} theme={theme} />}
      {kind === "native" && !account.observedAt && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>宿主未提供观测时间</Text>}
    </View>}
  </View>;
}
