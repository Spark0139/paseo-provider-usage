import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { providers, type ProviderKind } from "../shared/providers";
import { Button } from "./controls";
import { ProductCard } from "./product-card";
import { useUsage } from "./usage-data";

const productOrder = Object.keys(providers) as ProviderKind[];

export function Overview({ theme, host, layout, openSettings }: PluginScreenProps & { openSettings: () => void }) {
  const { overview, view, nativeEnabled, native, refresh, refreshError, busy, sources, now } = useUsage(host.id, "dashboard");
  const [panelWidth, setPanelWidth] = useState(0);
  const compact = layout.compact || (panelWidth > 0 && panelWidth < 640);
  const gap = compact ? 8 : 12;
  const padding = compact ? 12 : 16;
  const containerWidth = Math.max(0, panelWidth - padding * 2);
  // UsageProviderGrid uses a minimum 300px card, and lets the last row keep its natural height.
  const columnCount = compact ? 1 : Math.max(1, Math.min(productOrder.length, Math.floor((containerWidth + gap) / (300 + gap))));
  const cardWidth = containerWidth <= 0 ? "100%" : Math.floor((containerWidth - gap * (columnCount - 1)) / columnCount);
  const c = theme.colors;
  return <ScrollView testID="provider-usage-overview" style={{ flex: 1, backgroundColor: c.surface0 }}
    contentContainerStyle={{ width: "100%" }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, padding,
      borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: c.foreground, fontSize: 19, fontWeight: "600" }}>剩余额度</Text>
      <Button label={busy ? "读取中…" : "重新读取"} onPress={() => void refresh()} disabled={busy} theme={theme} small />
      <Button label="设置" onPress={openSettings} theme={theme} small />
    </View>
    {(overview.isError || refreshError) && <Text style={{ color: c.statusWarning, padding }}>读取额度失败，请检查主机连接后刷新。</Text>}
    <View style={{ padding }} onLayout={event => setPanelWidth(event.nativeEvent.layout.width)}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap }}>
        {view && productOrder.map(kind => {
          const group = sources.filter(source => source.kind === kind);
          const loading = kind === "native" && nativeEnabled && native.isLoading;
          const failed = kind === "native" && nativeEnabled && native.isError;
          if (!group.length && !loading && !failed) return null;
          return <ProductCard key={kind} hostId={host.id} kind={kind} width={cardWidth} sources={group} display={view.display} theme={theme} compact={compact} now={now}
            message={failed ? "读取额度失败" : loading ? "正在读取…" : undefined} failed={failed} />;
        })}
      </View>
    </View>
    {view && !sources.length && !nativeEnabled && <Text style={{ color: c.foregroundMuted }}>打开设置以添加账号或显示产品额度。</Text>}
  </ScrollView>;
}
