import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { usePaseo, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { overviewRpc, refreshKeeperRpc } from "../shared/contracts";
import { enabledCount, type Display, type SourceSnapshot } from "../shared/types";
import { Button } from "./controls";
import { AccountRows } from "./account-rows";
import { Timestamp } from "./timestamp";
import { antigravitySnapshot } from "./usage";

export const overviewKey = (host: string) => ["provider-usage", host, "overview"] as const;

const sourceIcon = { cpa: "Layers", claude: "Radio", native: "Orbit" } as const;
type CardProps = { theme: PluginTheme; display: Display; compact: boolean; now: number; source: SourceSnapshot };

function SourceCard({ source, display, theme, compact, now }: CardProps) {
  const [open, setOpen] = useState(true);
  const request = useRpc(refreshKeeperRpc);
  const update = useMutation({ mutationFn: () => request({ id: source.sourceId }), retry: false });
  const c = theme.colors;
  const keeper = source.kind === "cpa";
  const accounts = source.accounts.filter(account => display.showDisabledAccounts || account.enabled !== false);
  const firstWithQuota = accounts.find(account => account.enabled !== false && account.windows.some(w => w.usedPercent !== null));
  const initialAccount = firstWithQuota ?? accounts[0];
  const singleReport = !keeper && accounts.length === 1;
  const unknownEnabled = source.accounts.filter(account => account.enabled === null).length;
  const caption = keeper ? `Keeper · 启用 ${enabledCount(source.accounts)} / ${source.accounts.length}${unknownEnabled ? ` · ${unknownEnabled} 个启用状态未知` : ""}`
    : source.kind === "native" ? "Gemini · Paseo 原生" : "SDK 被动采集";
  return <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, backgroundColor: c.surface0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: compact ? 10 : 14,
      paddingVertical: 6, backgroundColor: c.surface1, borderTopLeftRadius: 8, borderTopRightRadius: 8,
      borderBottomLeftRadius: open ? 0 : 8, borderBottomRightRadius: open ? 0 : 8 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}>
        <View style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center",
          borderRadius: 6, backgroundColor: c.surface2 }}>
          <Icon name={sourceIcon[source.kind]} size={16} color={c.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.foreground, fontSize: 16, fontWeight: "600" }}>{source.label}</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{caption}</Text>
        </View>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={c.foregroundMuted} />
      </Pressable>
      {keeper && open && <Button label={update.isPending ? "提交中…" : "更新 Keeper 额度"} theme={theme}
        small onPress={() => update.mutate()} disabled={update.isPending} />}
    </View>
    {update.data && open && <Text accessibilityLiveRegion="polite" style={{ color: c.foregroundMuted, fontSize: 12, padding: 8 }}>
      {`已提交 ${update.data.queued} · 已在队列 ${update.data.pending} · 失败 ${update.data.failed}。稍后点击「重新读取」查看额度。`}
    </Text>}
    {(source.error || update.error) && <Text accessibilityLiveRegion="polite" style={{ color: c.statusWarning, padding: 8 }}>
      {[source.error, update.error?.message].filter(Boolean).join(" · ")}
    </Text>}
    {!open && source.lastSuccessAt && <View style={{ paddingHorizontal: 14, paddingBottom: 4 }}>
      <Timestamp label="最近观测" iso={source.lastSuccessAt} now={now} theme={theme} />
    </View>}
    {open && accounts.map(account => <AccountRows key={account.id} account={account} kind={source.kind} sourceLabel={source.label}
      initialOpen={!keeper || account.id === initialAccount?.id} singleReport={singleReport}
      theme={theme} compact={compact} now={now} showCountdown={display.showResetCountdown} />)}
    {open && !accounts.length && <Text style={{ color: c.foregroundMuted, padding: 12 }}>
      {source.accounts.length ? "已隐藏停用账号" : source.kind === "native" ? "宿主暂无 Antigravity 额度报告" : "暂无账号数据"}
    </Text>}
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
  const [narrowContent, setNarrowContent] = useState(false);
  const compact = layout.compact || narrowContent;
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
    onLayout={event => setNarrowContent(event.nativeEvent.layout.width < 640)}
    contentContainerStyle={{ padding: compact ? 10 : 20, gap: 10, width: "100%", maxWidth: 920, alignSelf: "center" }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: c.foreground, fontSize: 19, fontWeight: "600" }}>剩余额度</Text>
      <Button label={busy ? "读取中…" : "重新读取"} onPress={() => void refresh()} disabled={busy} theme={theme} small />
      <Button label="设置" onPress={openSettings} theme={theme} small />
    </View>
    {overview.isError && <Text style={{ color: c.statusWarning }}>读取额度失败，请检查主机连接后刷新。</Text>}
    {view && sources.map(source => <SourceCard key={source.sourceId} source={source} display={view.display} theme={theme} compact={compact} now={now} />)}
    {view && !sources.length && !nativeEnabled && <Text style={{ color: c.foregroundMuted }}>打开设置可添加 Keeper 实例或启用 Claude 采集。</Text>}
    {nativeEnabled && native.isLoading && <Text style={{ color: c.foregroundMuted }}>正在读取 Paseo 原生额度…</Text>}
    {nativeEnabled && native.isError && <Text style={{ color: c.statusWarning }}>无法读取 Paseo 原生额度报告。</Text>}
  </ScrollView>;
}
