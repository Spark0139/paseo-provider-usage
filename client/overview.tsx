import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { usePaseo, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View, type DimensionValue } from "react-native";
import { overviewRpc, refreshKeeperRpc } from "../shared/contracts";
import { enabledCount, type Account, type Display, type SourceSnapshot } from "../shared/types";
import { providers, type ProviderKind } from "../shared/providers";
import { productIcons } from "./product-icons";
import { Button } from "./controls";
import { AccountRows } from "./account-rows";
import { Timestamp } from "./timestamp";
import { antigravitySnapshot } from "../shared/native-usage";

export const overviewKey = (host: string) => ["provider-usage", host, "overview"] as const;

type CardProps = { theme: PluginTheme; display: Display; compact: boolean; now: number };
const productOrder = Object.keys(providers) as ProviderKind[];

function accountCount(accounts: Account[]) {
  const unknown = accounts.filter(account => account.enabled === null).length;
  return `启用 ${enabledCount(accounts)} / ${accounts.length}${unknown ? ` · ${unknown} 个状态未知` : ""}`;
}

function SourceSection({ source, open, grouped, display, theme, compact, now }: CardProps & {
  source: SourceSnapshot; open: boolean; grouped: boolean;
}) {
  const request = useRpc(refreshKeeperRpc);
  const update = useMutation({ mutationFn: () => request({ id: source.sourceId }), retry: false });
  const c = theme.colors;
  const keeper = source.kind === "cpa";
  const accounts = source.accounts.filter(account => display.showDisabledAccounts || account.enabled !== false);
  const initialAccount = accounts.find(account => account.enabled !== false && account.windows.some(w => w.usedPercent !== null)) ?? accounts[0];
  const error = [source.error, update.error?.message].filter(Boolean).join(" · ");
  const name = grouped ? source.instanceLabel : undefined;
  if (!open) return error ? <Text accessibilityLiveRegion="polite" style={{ color: c.statusWarning, padding: 8 }}>
    {name ? `${name} · ` : ""}{error}
  </Text> : null;
  return <View style={{ gap: compact ? 8 : 12 }}>
    {keeper && <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap",
      gap: 6 }}>
      {name && <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: "600", flexShrink: 1 }}>{name}</Text>}
      <Text style={{ color: c.foregroundMuted, fontSize: 12, flexGrow: 1 }}>{accountCount(source.accounts)}</Text>
      <Button label={update.isPending ? "提交中…" : "更新额度"} theme={theme}
        small onPress={() => update.mutate()} disabled={update.isPending} />
    </View>}
    {update.data && <Text accessibilityLiveRegion="polite" style={{ color: update.data.failed ? c.statusWarning : c.foregroundMuted, fontSize: 12, padding: 8 }}>
      {`已提交 ${update.data.queued} · 已在队列 ${update.data.pending} · 失败 ${update.data.failed}。稍后点击「重新读取」查看额度。`}
    </Text>}
    {error && <Text accessibilityLiveRegion="polite" style={{ color: c.statusWarning, padding: 8 }}>{error}</Text>}
    {accounts.map(account => <AccountRows key={account.id} account={account} kind={source.kind} sourceLabel={source.label}
      initialOpen={!keeper || account.id === initialAccount?.id} singleReport={!keeper && accounts.length === 1}
      theme={theme} compact={compact} now={now} showCountdown={display.showResetCountdown} />)}
    {!error && !accounts.length && <Text style={{ color: c.foregroundMuted, padding: 12 }}>
      {source.accounts.length ? "已隐藏停用账号" : keeper ? "暂无账号" : "暂无额度报告"}
    </Text>}
  </View>;
}

// ProviderCard identity, StatusDot and card chrome adapted from Usage Monitor's limits.client.tsx.
function ProductCard({ kind, sources, width, message, failed, ...props }: CardProps & {
  kind: ProviderKind; sources: SourceSnapshot[]; width: DimensionValue; message?: string; failed?: boolean;
}) {
  const [open, setOpen] = useState(true);
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
  return <View testID={`provider-card-${kind}`} style={{ width, padding, gap, backgroundColor: c.surface1,
    borderRadius: 12, borderWidth: 1, borderColor: c.border }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap }}>
      <Pressable accessibilityRole="button" accessibilityLabel={product.label} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
        style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, flexGrow: 1, flexShrink: 1 }}>
        <Icon icon={productIcons[product.id]} size={compact ? 24 : 28} color={c.foreground} />
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
        <Text accessibilityRole="header" style={{ color: c.foreground, fontSize: compact ? 13 : 14, fontWeight: "600", flexShrink: 1 }}>{product.label}</Text>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={c.foregroundMuted} />
      </Pressable>
      {latest && <Timestamp label="最近观测" iso={latest} now={now} theme={theme} alignEnd />}
    </View>
    {count && <Text style={{ color: c.foregroundMuted, fontSize: compact ? 11 : 12 }}>{count}</Text>}
    {(open || failed) && message && <Text accessibilityLiveRegion="polite" style={{ color: failed ? c.statusWarning : c.foregroundMuted }}>{message}</Text>}
    {sources.map(source => <SourceSection key={source.sourceId} source={source} open={open} grouped={grouped} {...props} />)}
  </View>;
}

const onDemand = { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

export function Overview({ theme, host, layout, openSettings }: PluginScreenProps & { openSettings: () => void }) {
  const read = useRpc(overviewRpc);
  const paseo = usePaseo();
  const cache = useQueryClient();
  const overview = useQuery({ queryKey: overviewKey(host.id), queryFn: () => read({}), ...onDemand });
  const view = overview.data;
  const nativeEnabled = !!view && !view.mock && view.display.showNativeProviders;
  const native = useQuery({
    queryKey: ["provider-usage", host.id, "antigravity"],
    queryFn: async () => antigravitySnapshot(await paseo.providers.listUsage()),
    enabled: nativeEnabled, ...onDemand,
  });
  async function refresh() {
    try {
      const updated = await cache.fetchQuery({
        queryKey: overviewKey(host.id), queryFn: () => read({ refresh: true }), retry: false,
      });
      if (nativeEnabled && updated.display.showNativeProviders && !updated.mock) await native.refetch();
    } catch { /* The query retains any previous data and exposes its error in the panel. */ }
  }
  const [now, setNow] = useState(Date.now);
  const [panelWidth, setPanelWidth] = useState(0);
  const compact = layout.compact || (panelWidth > 0 && panelWidth < 640);
  const gap = compact ? 8 : 12;
  const padding = compact ? 12 : 16;
  const containerWidth = Math.max(0, panelWidth - padding * 2);
  // UsageProviderGrid uses a minimum 300px card, and lets the last row keep its natural height.
  const columnCount = compact ? 1 : Math.max(1, Math.min(productOrder.length, Math.floor((containerWidth + gap) / (300 + gap))));
  const cardWidth = containerWidth <= 0 ? "100%" : Math.floor((containerWidth - gap * (columnCount - 1)) / columnCount);
  useEffect(() => {
    if (!view) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [!!view]);
  const c = theme.colors;
  const busy = overview.isFetching || (nativeEnabled && native.isFetching);
  const sources = (view?.sources ?? []).filter(source => source.kind !== "native" || view?.display.showNativeProviders);
  if (nativeEnabled && native.data) sources.push(native.data);
  return <ScrollView testID="provider-usage-overview" style={{ flex: 1, backgroundColor: c.surface0 }}
    contentContainerStyle={{ width: "100%" }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, padding,
      borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: c.foreground, fontSize: 19, fontWeight: "600" }}>剩余额度</Text>
      <Button label={busy ? "读取中…" : "重新读取"} onPress={() => void refresh()} disabled={busy} theme={theme} small />
      <Button label="设置" onPress={openSettings} theme={theme} small />
    </View>
    {overview.isError && <Text style={{ color: c.statusWarning, padding }}>读取额度失败，请检查主机连接后刷新。</Text>}
    <View style={{ padding }} onLayout={event => setPanelWidth(event.nativeEvent.layout.width)}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap }}>
        {view && productOrder.map(kind => {
          const group = sources.filter(source => source.kind === kind);
          const loading = kind === "native" && nativeEnabled && native.isLoading;
          const failed = kind === "native" && nativeEnabled && native.isError;
          if (!group.length && !loading && !failed) return null;
          return <ProductCard key={kind} kind={kind} width={cardWidth} sources={group} display={view.display} theme={theme} compact={compact} now={now}
            message={failed ? "读取额度失败" : loading ? "正在读取…" : undefined} failed={failed} />;
        })}
      </View>
    </View>
    {view && !sources.length && !nativeEnabled && <Text style={{ color: c.foregroundMuted }}>打开设置以添加账号或显示产品额度。</Text>}
  </ScrollView>;
}
