import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Account, SourceSnapshot } from "../shared/types";
import { ReadingGroups, windowLabel, remaining, type RowProps } from "./window-row";
import { Timestamp } from "./timestamp";

const stateLabels = {
  available: "可用", exhausted: "额度耗尽", disabled: "已停用", unavailable: "额度不可用", unknown: "额度未知",
};

function AccountState({ account, keeper, theme }: { account: Account; keeper: boolean; theme: PluginTheme }) {
  const labels = [account.planLabel];
  if (keeper) labels.push(account.enabled === null ? "启用状态未知" : account.enabled ? "已启用" : "已停用");
  const status = account.state !== "available" && !(keeper && account.state === "disabled") ? stateLabels[account.state] : null;
  const note = labels.filter(Boolean).join(" · ");
  const warning = account.state === "exhausted" || account.state === "unavailable";
  return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
    {note}{note && status ? " · " : ""}{status && <Text style={{ color: warning ? theme.colors.statusWarning : undefined }}>{status}</Text>}
  </Text>;
}

type AccountProps = RowProps & {
  conciseErrors?: boolean; account: Account; kind: SourceSnapshot["kind"]; sourceLabel: string; initialOpen: boolean; singleReport: boolean;
};

export function AccountRows({ conciseErrors, account, kind, sourceLabel, initialOpen, singleReport, ...row }: AccountProps) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const { theme, compact, now } = row;
  const c = theme.colors;
  const open = singleReport || (expanded ?? initialOpen);
  const windows = account.windows;
  const preview = windows.slice(0, 2).map(w => `${windowLabel(w)} ${remaining(w.usedPercent)}`).join("   ");
  const state = <AccountState account={account} keeper={kind === "cpa"} theme={theme} />;
  return <View style={{ borderTopWidth: singleReport ? 0 : 1, borderTopColor: c.border, gap: 4 }}>
    {singleReport
      ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {kind !== "claude" && account.label !== sourceLabel && <Text style={{ color: c.foreground, fontWeight: "500" }}>{account.label}</Text>}
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
    {account.error && <Text style={{ color: c.statusWarning, fontSize: 13, paddingVertical: 3 }}>{conciseErrors ? (/HTTP (401|403)\b/.test(account.error) ? "账号认证失败" : "账号额度读取失败") : account.error}</Text>}
    {open && <View style={{ gap: compact ? 8 : 12 }}>
      {windows.length > 0 && <ReadingGroups windows={windows} {...row} />}
      {!windows.length && !account.error && <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>
        {kind === "claude" ? "等待首次额度事件" : "暂无额度窗口"}
      </Text>}
      {(!singleReport || kind === "native") && account.observedAt && <Timestamp label="最近观测" iso={account.observedAt} now={now} theme={theme} />}
    </View>}
  </View>;
}
