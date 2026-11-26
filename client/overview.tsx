import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { overviewRpc } from "../shared/contracts";
import { enabledCount, type Account, type Display, type SourceSnapshot } from "../shared/types";
import { Button, RemainingBar } from "./controls";
import { antigravitySnapshot, countdown, localDate } from "./usage";

const stateLabel = {
  available: "可用", exhausted: "额度耗尽", disabled: "已停用", unavailable: "不可用", unknown: "未知",
};
type CardProps = { theme: PluginTheme; display: Display; now: number };
export const overviewKey = (host: string) => ["provider-usage", host, "overview"] as const;

function AccountCard({ account, expandedInitially, kind, theme, display, now }: CardProps & {
  account: Account; expandedInitially: boolean; kind: SourceSnapshot["kind"];
}) {
  const [open, setOpen] = useState(expandedInitially);
  const c = theme.colors;
  const metadata: string[] = [];
  if (account.planLabel) metadata.push(account.planLabel);
  if (kind === "cpa") {
    metadata.push(account.enabled === null ? "启用状态未知" : account.enabled ? "已启用" : "已停用");
  }
  if (account.state !== "disabled" || kind !== "cpa") metadata.push(stateLabel[account.state]);
  return <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border, gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
      style={{ gap: 2, paddingVertical: 3 }}>
      <Text style={{ color: c.foreground, fontWeight: "600" }}>{open ? "▾" : "▸"} {account.label}</Text>
      <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{metadata.join(" · ")}</Text>
    </Pressable>
    {account.error && <Text style={{ color: c.statusWarning }}>{account.error}</Text>}
    {open && <View style={{ gap: 12 }}>
      {account.windows.map(window => <View key={window.id} style={{ gap: 5 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ color: c.foreground }}>{window.label}</Text>
          <Text style={{ color: c.foreground, fontWeight: "600" }}>{window.usedPercent == null
            ? "剩余 —" : `剩余 ${Number((100 - window.usedPercent).toFixed(1))}%`}</Text>
        </View>
        {window.usedPercent != null && <RemainingBar used={window.usedPercent} theme={theme} />}
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>重置 {window.resetAt ? localDate(window.resetAt) : "—"}
          {display.showResetCountdown && window.resetAt ? ` · ${countdown(window.resetAt, now)}` : ""}</Text>
      </View>)}
      {account.windows.length === 0 && <Text style={{ color: c.foregroundMuted }}>暂无额度窗口</Text>}
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
        {account.observedAt ? `最近观测 ${localDate(account.observedAt)}` : kind === "native" ? "宿主未提供观测时间" : "暂无有效观测"}
      </Text>
    </View>}
  </View>;
}

function SourceCard({ source, display, theme, now }: CardProps & { source: SourceSnapshot }) {
  const [open, setOpen] = useState(true);
  const c = theme.colors;
  const accounts = source.accounts.filter(account => display.showDisabledAccounts || account.enabled !== false);
  const caption = source.kind === "cpa" ? `CPA · 启用 ${enabledCount(source.accounts)} / ${source.accounts.length}`
    : source.kind === "native" ? "Paseo 原生" : "Claude SDK · 被动采集";
  return <View style={{ backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border,
    borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
      style={{ paddingVertical: 6, gap: 3 }}>
      <Text style={{ color: c.foreground, fontSize: 17, fontWeight: "600" }}>{open ? "▾" : "▸"} {source.label}</Text>
      <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{caption}</Text>
      {source.lastSuccessAt && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>最近有效更新 {localDate(source.lastSuccessAt)}</Text>}
    </Pressable>
    {source.error && <Text style={{ color: c.statusWarning, paddingVertical: 5 }}>{source.error}</Text>}
    {open && accounts.map(account => <AccountCard key={account.id} account={account} expandedInitially={accounts.length === 1}
      kind={source.kind} display={display} theme={theme} now={now} />)}
    {open && accounts.length === 0 && <Text style={{ color: c.foregroundMuted, paddingVertical: 8 }}>
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
  useEffect(() => {
    if (!view?.display.showResetCountdown) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [view?.display.showResetCountdown]);
  const c = theme.colors;
  const busy = overview.isFetching || (nativeEnabled && native.isFetching);
  const sources = (view?.sources ?? []).filter(source => source.kind !== "native" || view?.display.showNativeProviders);
  if (nativeEnabled && native.data) sources.push(native.data);
  return <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }}
    contentContainerStyle={{ padding: layout.compact ? 12 : 22, gap: 12, width: "100%", maxWidth: 800, alignSelf: "center" }}>
    <View style={{ flexDirection: "row", gap: 8, alignSelf: "flex-end" }}>
      <Button label={busy ? "读取中…" : "刷新"} onPress={() => void refresh()} disabled={busy} theme={theme} />
      <Button label="设置" onPress={openSettings} theme={theme} />
    </View>
    {overview.isError && <Text style={{ color: c.statusWarning }}>读取额度失败，请检查主机连接后刷新。</Text>}
    {view && sources.map(source => <SourceCard key={source.sourceId} source={source} display={view.display} theme={theme} now={now} />)}
    {view && !sources.length && !nativeEnabled && <Text style={{ color: c.foregroundMuted }}>打开设置可添加 CPA 实例或启用 Claude 采集。</Text>}
    {nativeEnabled && native.isLoading && <Text style={{ color: c.foregroundMuted }}>正在读取 Paseo 原生额度…</Text>}
    {nativeEnabled && native.isError && <Text style={{ color: c.statusWarning }}>无法读取 Paseo 原生额度报告。</Text>}
  </ScrollView>;
}
