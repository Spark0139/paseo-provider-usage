import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View, type DimensionValue } from "react-native";
import { enabledCount, type Account, type Display, type SourceSnapshot } from "../shared/types";
import { providers, type ProviderKind } from "../shared/providers";
import { productIcons } from "./product-icons";
import { Button } from "./controls";
import { AccountRows } from "./account-rows";
import { Timestamp } from "./timestamp";
import { useKeeperUpdate } from "./usage-data";

type CardProps = { hostId: string; floating?: boolean; theme: PluginTheme; display: Display; compact: boolean; now: number };

function accountCount(accounts: Account[]) {
  const unknown = accounts.filter(account => account.enabled === null).length;
  return `启用 ${enabledCount(accounts)} / ${accounts.length}${unknown ? ` · ${unknown} 个状态未知` : ""}`;
}

function SourceSection({ source, open, grouped, display, theme, compact, now, hostId, floating }: CardProps & {
  source: SourceSnapshot; open: boolean; grouped: boolean;
}) {
  const c = theme.colors;
  const keeper = source.kind === "cpa";
  const update = useKeeperUpdate(hostId, source.sourceId, keeper && open);
  const accounts = source.accounts.filter(account => display.showDisabledAccounts || account.enabled !== false);
  const initialAccount = accounts.find(account => account.enabled !== false && account.windows.some(w => w.usedPercent !== null)) ?? accounts[0];
  const error = source.error && (floating ? (keeper ? "读取 Keeper 额度失败" : "读取额度失败") : source.error);
  const name = grouped ? source.instanceLabel : undefined;
  if (!open) return error ? <Text accessibilityLiveRegion="polite" style={{ color: c.statusWarning, padding: 8 }}>
    {name ? `${name} · ` : ""}{error}
  </Text> : null;
  return <View style={{ gap: compact ? 8 : 12 }}>
    {keeper && <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap",
      gap: 6 }}>
      {name && <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: "600", flexShrink: 1 }}>{name}</Text>}
      <Text style={{ color: c.foregroundMuted, fontSize: 12, flexGrow: 1 }}>{accountCount(source.accounts)}</Text>
      <Button label={update.submitting ? "提交中…" : update.pending ? "更新中…" : "更新额度"} theme={theme}
        small onPress={update.submit} disabled={update.submitting || update.pending} />
    </View>}
    {keeper && update.message && <Text accessibilityLiveRegion="polite" style={{ color: update.warning ? c.statusWarning : c.foregroundMuted, fontSize: 12 }}>
      {update.message}
    </Text>}
    {error && <Text accessibilityLiveRegion="polite" style={{ color: c.statusWarning, padding: 8 }}>{error}</Text>}
    {accounts.map(account => <AccountRows key={account.id} account={account} conciseErrors={floating} kind={source.kind} sourceLabel={source.label}
      initialOpen={!keeper || account.id === initialAccount?.id} singleReport={!keeper && accounts.length === 1}
      theme={theme} compact={compact} now={now} showCountdown={display.showResetCountdown} />)}
    {!error && !accounts.length && <Text style={{ color: c.foregroundMuted, padding: 12 }}>
      {source.accounts.length ? "已隐藏停用账号" : keeper ? "暂无账号" : "暂无额度报告"}
    </Text>}
  </View>;
}

// ProviderCard identity, StatusDot and card chrome adapted from Usage Monitor's limits.client.tsx.
export function ProductCard({ kind, sources, width, message, failed, ...props }: CardProps & {
  kind: ProviderKind; sources: SourceSnapshot[]; width: DimensionValue; message?: string; failed?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const open = props.floating || expanded;
  const { theme, compact, now } = props;
  const c = theme.colors;
  const product = providers[kind];
  const grouped = sources.length > 1;
  const accounts = sources.flatMap(source => source.accounts);
  const count = kind === "cpa" && (grouped || !open) ? accountCount(accounts) : null;
  const latest = sources.flatMap(source => source.lastSuccessAt ? [source.lastSuccessAt] : []).sort().at(-1);
  const error = failed || sources.some(source => source.error);
  const attention = accounts.some(account => account.error || account.state === "exhausted" || account.state === "unavailable");
  const dot = error ? c.statusDanger : attention ? c.statusWarning
    : accounts.some(account => account.state === "available") ? c.statusSuccess : c.foregroundMuted;
  const padding = compact ? 12 : 16;
  const gap = compact ? 8 : 12;
  return <View testID={`provider-card-${kind}`} style={props.floating ? { gap } : { width, padding, gap, backgroundColor: c.surface1,
    borderRadius: 12, borderWidth: 1, borderColor: c.border }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap }}>
      <Pressable disabled={props.floating} accessibilityRole={props.floating ? "header" : "button"} accessibilityLabel={product.label}
        accessibilityState={props.floating ? undefined : { expanded: open }} onPress={() => setExpanded(!open)}
        style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, flexGrow: 1, flexShrink: 1 }}>
        <Icon icon={productIcons[product.id]} size={compact ? 24 : 28} color={c.foreground} />
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
        <Text accessibilityRole="header" style={{ color: c.foreground, fontSize: compact ? 13 : 14, fontWeight: "600", flexShrink: 1 }}>{product.label}</Text>
        {!props.floating && <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={c.foregroundMuted} />}
      </Pressable>
      {latest && <Timestamp label="最近观测" iso={latest} now={now} theme={theme} alignEnd />}
    </View>
    {count && <Text style={{ color: c.foregroundMuted, fontSize: compact ? 11 : 12 }}>{count}</Text>}
    {(open || failed) && message && <Text accessibilityLiveRegion="polite" style={{ color: failed ? c.statusWarning : c.foregroundMuted }}>{message}</Text>}
    {sources.map(source => <SourceSection key={source.sourceId} source={source} open={open} grouped={grouped} {...props} />)}
  </View>;
}
