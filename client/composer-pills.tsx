import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { settingsRpc, type SettingsView } from "../shared/contracts";
import { providers, type ProviderKind } from "../shared/providers";
import { enabledCount, type SourceSnapshot } from "../shared/types";
import { productIcons } from "./product-icons";
import { ProductCard } from "./product-card";
import { useUsage } from "./usage-data";
import { remaining, windowLabel } from "./window-row";

const kinds = Object.keys(providers) as ProviderKind[];

function pillReading(kind: ProviderKind, sources: SourceSnapshot[]) {
  const accounts = sources.filter(source => source.kind === kind).flatMap(source => source.accounts);
  const windows = accounts.flatMap(account => account.windows);
  const name = providers[kind].label;
  if (kind === "cpa") return { label: accounts.length ? `${name} ${enabledCount(accounts)}/${accounts.length} 启用` : name };
  if (kind === "native") return { label: windows.length ? `${name} ${windows.length} 个窗口` : name };
  const window = windows.find(w => w.id === "five_hour" && w.usedPercent !== null) ?? windows.find(w => w.usedPercent !== null);
  if (!window || window.usedPercent === null) return { label: `${name} 待观测` };
  return { label: `${name} ${windowLabel(window)} 剩余 ${remaining(window.usedPercent)}`, used: window.usedPercent };
}

// Usage Monitor's rail mark sits in the host's icon slot with a 3px bar beneath it.
function PillMark({ kind, publish, host, theme, size }: PluginButtonIconProps & {
  kind: ProviderKind; publish(label: string): void;
}) {
  const { view, sources } = useUsage(host.id, "rail");
  const { label, used } = pillReading(kind, sources);
  useEffect(() => { if (view) publish(label); }, [view, label, publish]);
  const c = theme.colors;
  const hasBar = used !== undefined;
  return <View testID={`quota-pill-${providers[kind].id}`} style={{ width: size, height: size, alignItems: "center",
    justifyContent: hasBar ? "space-between" : "center", flexShrink: 0 }}>
    <Icon icon={productIcons[providers[kind].id]} size={hasBar ? Math.round(size * 10 / 14) : size} color={c.foreground} />
    {hasBar && <View style={{ width: "100%", height: 3, borderRadius: 1.5, backgroundColor: c.surface0, overflow: "hidden" }}>
      <View style={{ height: 3, borderRadius: 1.5, width: `${100 - used}%`,
        backgroundColor: used > 90 ? c.statusDanger : used >= 70 ? c.statusWarning : c.accent }} />
    </View>}
  </View>;
}

// The host anchors and scrolls this body and presents the same content in a mobile sheet.
function QuotaPopover({ kind, openOverview, host, theme, close }: PluginButtonContentProps & {
  kind: ProviderKind; openOverview(): void;
}) {
  const { view, sources, overview, native, nativeEnabled, refresh, busy, now, refreshError } = useUsage(host.id, kind);
  const group = sources.filter(source => source.kind === kind);
  const c = theme.colors;
  const failed = overview.isError || refreshError || (kind === "native" && nativeEnabled && native.isError);
  const loading = !view || (kind === "native" && nativeEnabled && native.isLoading);
  const message = failed ? "读取额度失败" : loading ? "正在读取…" : !group.length ? "暂无额度报告" : undefined;
  return <View testID={`quota-popover-${providers[kind].id}`} style={{ gap: 2 }}>
    {view ? <ProductCard kind={kind} sources={group} hostId={host.id} width="100%" display={view.display}
      theme={theme} compact now={now} floating message={message} failed={failed} /> :
      <Text style={{ color: failed ? c.statusWarning : c.foregroundMuted }}>{message}</Text>}
    <View style={{ height: 1, marginVertical: 6, backgroundColor: c.border }} />
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <Pressable accessibilityRole="button" onPress={() => { close(); openOverview(); }} style={{ paddingVertical: 4 }}>
        <Text style={{ fontSize: 12, color: c.accent }}>查看全部额度</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="重新读取" accessibilityState={{ disabled: busy }} disabled={busy}
        onPress={refresh} style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", opacity: busy ? 0.5 : 1 }}>
        <Icon name="RefreshCw" size={14} color={c.foregroundMuted} />
      </Pressable>
    </View>
  </View>;
}

type AgentPills = { workspaceId: string; handles: Map<ProviderKind, PluginButtonRegistration> };

export function contributeComposerPills(client: PluginClientContext) {
  const agents = new Map<string, AgentPills>();
  const labels = new Map<ProviderKind, string>();
  let configured: ProviderKind[] = [];
  let settingsVersion = 0;
  const lifetime = new AbortController();
  // Components and registration handles stay stable as labels change, so an open popover stays open.
  const buttons = new Map(kinds.map(kind => {
    function publish(label: string) {
      if (labels.get(kind) === label) return;
      labels.set(kind, label);
      for (const agent of agents.values()) agent.handles.get(kind)?.update({ label });
    }
    const icon = (props: PluginButtonIconProps) => <PillMark {...props} kind={kind} publish={publish} />;
    const Content = (props: PluginButtonContentProps) => <QuotaPopover {...props} kind={kind} openOverview={() => client.openScreen({ screenId: "usage" })} />;
    return [kind, { title: `${providers[kind].label} 额度`, icon, behavior: { kind: "popover" as const, Content } }] as const;
  }));

  function sync(id: string, agent: AgentPills) {
    for (const [kind, handle] of agent.handles) {
      if (configured.includes(kind)) continue;
      handle.remove();
      agent.handles.delete(kind);
    }
    for (const kind of configured) {
      if (agent.handles.has(kind)) continue;
      const button = buttons.get(kind)!;
      agent.handles.set(kind, client.addComposerPill({ id: `quota-${providers[kind].id}`, workspaceId: agent.workspaceId, agentId: id,
        button: { ...button, label: labels.get(kind) ?? providers[kind].label } }));
    }
  }
  function onSettings(value: SettingsView) {
    settingsVersion++;
    configured = kinds.filter(kind => kind === "cpa" ? value.instances.length > 0 : kind === "claude" ? value.claude.enabled : value.display.showNativeProviders);
    for (const kind of kinds) if (!configured.includes(kind)) labels.delete(kind);
    for (const [id, agent] of agents) sync(id, agent);
  }
  function remove(id: string) {
    for (const handle of agents.get(id)?.handles.values() ?? []) handle.remove();
    agents.delete(id);
  }
  function track({ id, workspaceId }: { id: string; workspaceId?: string | null }) {
    if (workspaceId === agents.get(id)?.workspaceId) return;
    remove(id);
    if (workspaceId) {
      const agent: AgentPills = { workspaceId, handles: new Map() };
      agents.set(id, agent);
      sync(id, agent);
    }
  }
  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ subscription }) => {
    if (lifetime.signal.aborted) return;
    subscription.subscribe({
      snapshot({ entries }) {
        if (lifetime.signal.aborted) return;
        const present = new Set(entries.map(entry => entry.agent.id));
        for (const id of agents.keys()) if (!present.has(id)) remove(id);
        for (const { agent } of entries) track(agent);
        const version = settingsVersion;
        void client.rpc(settingsRpc, {}).then(settings => {
          if (!lifetime.signal.aborted && settingsVersion === version) onSettings(settings);
        }).catch(() => { /* A reconnect supplies a fresh directory and settings. */ });
      },
      update(message) {
        if (lifetime.signal.aborted || message.type !== "agent_update") return;
        const update = message.payload;
        if (update.kind === "remove") remove(update.agentId);
        else track(update.agent);
      },
    });
  }).catch(() => { /* The dashboard remains available if directory observation is unavailable. */ });
  return {
    onSettings,
    dispose() {
      lifetime.abort();
      for (const id of agents.keys()) remove(id);
    },
  };
}
