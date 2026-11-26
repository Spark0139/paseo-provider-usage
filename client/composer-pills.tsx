import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { settingsRpc, type SettingsView } from "../shared/contracts";
import { providers, type ProviderKind } from "../shared/providers";
import type { CodexAccountRef, SourceSnapshot } from "../shared/types";
import { codexAccounts, codexPeriod, displayedCodexAccount } from "./codex-account";
import { productIcons } from "./product-icons";
import { ProductCard } from "./product-card";
import { useOverview, useUsage } from "./usage-data";
import { remaining } from "./window-row";
import { createPillRefs, createSheetRef, usePillRef, type BindPillView } from "./web";

const kinds = Object.keys(providers) as ProviderKind[];

function pillReading(kind: ProviderKind, sources: SourceSnapshot[], preferred: CodexAccountRef | null) {
  const name = providers[kind].label;
  if (kind === "native") return { label: name };
  if (kind === "cpa") {
    const row = displayedCodexAccount(codexAccounts(sources), preferred);
    const window = row?.window;
    const used = window?.usedPercent ?? undefined;
    const period = window ? codexPeriod(window) : "";
    const percent = remaining(used ?? null);
    const label = `${period && period !== "5h" ? period : name} ${percent}`;
    const title = row ? [name, row.label, period, `剩余 ${percent}`].filter(Boolean).join(" · ") : `${name} · 暂无可显示的常用账号`;
    return { label, title, used };
  }
  const accounts = sources.filter(source => source.kind === kind).flatMap(source => source.accounts);
  const windows = accounts.flatMap(account => account.windows);
  const window = windows.find(w => w.id === "five_hour" && w.usedPercent !== null) ?? windows.find(w => w.usedPercent !== null);
  if (!window || window.usedPercent === null) return { label: `${name} —` };
  return { label: `${name} ${remaining(window.usedPercent)}`, used: window.usedPercent };
}

// Usage Monitor's rail mark sits in the host's icon slot with a 3px bar beneath it.
function PillMark({ kind, publish, host, theme, size, bindAnchor }: PluginButtonIconProps & {
  bindAnchor?: BindPillView; kind: ProviderKind; publish(label: string, title?: string): void;
}) {
  const anchorRef = usePillRef(bindAnchor);
  // Paseo can keep a second composer mounted under display:none.
  const [visible, setVisible] = useState(false);
  const { overview } = useOverview(host.id, kind === "cpa" ? "codex-rail" : "rail", visible && kind !== "native");
  const view = overview.data;
  const { label, title, used } = pillReading(kind, view?.sources ?? [], view?.codexAccount ?? null);
  useEffect(() => { if (view) publish(label, title); }, [view, label, title, publish]);
  const c = theme.colors;
  const hasBar = used !== undefined;
  return <View ref={anchorRef} testID={`quota-pill-${providers[kind].id}`} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    setVisible(width > 0 && height > 0);
  }} style={{ width: size, height: size, alignItems: "center",
    justifyContent: hasBar ? "space-between" : "center", flexShrink: 0 }}>
    <Icon icon={productIcons[providers[kind].id]} size={hasBar ? Math.round(size * 10 / 14) : size} color={c.foreground} />
    {hasBar && <View style={{ width: "100%", height: 3, borderRadius: 1.5, backgroundColor: c.surface0, overflow: "hidden" }}>
      <View style={{ height: 3, borderRadius: 1.5, width: `${100 - used}%`,
        backgroundColor: used > 90 ? c.statusDanger : used >= 70 ? c.statusWarning : c.accent }} />
    </View>}
  </View>;
}

// The host anchors and scrolls this body and presents the same content in a mobile sheet.
function QuotaPopover({ kind, openOverview, host, theme, close, bindContent }: PluginButtonContentProps & {
  bindContent?: BindPillView; kind: ProviderKind; openOverview(): void;
}) {
  const contentRef = usePillRef(bindContent);
  const { view, sources, overview, native, nativeEnabled, refresh, busy, now, refreshError } = useUsage(host.id, kind);
  const group = sources.filter(source => source.kind === kind);
  const c = theme.colors;
  const failed = overview.isError || refreshError || (kind === "native" && nativeEnabled && native.isError);
  const loading = !view || (kind === "native" && nativeEnabled && native.isLoading);
  const message = failed ? "读取额度失败" : loading ? "正在读取…" : !group.length ? "暂无额度报告" : undefined;
  return <View ref={contentRef} testID={`quota-popover-${providers[kind].id}`} style={{ gap: 2 }}>
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
  const captions = new Map<ProviderKind, { label: string; title: string }>();
  let configured: ProviderKind[] = [];
  let settingsVersion = 0;
  const lifetime = new AbortController();
  // Components and registration handles stay stable as labels change, so an open popover stays open.
  function createButton(kind: ProviderKind) {
    const refs = createPillRefs();
    const sheetRef = createSheetRef();
    const defaultTitle = `${providers[kind].label} 额度`;
    function publish(label: string, title = defaultTitle) {
      const previous = captions.get(kind);
      if (previous?.label === label && previous.title === title) return;
      captions.set(kind, { label, title });
      for (const agent of agents.values()) agent.handles.get(kind)?.update({ label, title });
    }
    const icon = (props: PluginButtonIconProps) => <PillMark {...props} kind={kind} publish={publish}
      bindAnchor={props.layout.platform === "web" && !props.layout.compact ? refs.anchor : undefined} />;
    const Content = (props: PluginButtonContentProps) => <QuotaPopover {...props} kind={kind}
      bindContent={props.layout.platform === "web" ? (props.layout.compact ? sheetRef : refs.content) : undefined}
      openOverview={() => client.openScreen({ screenId: "usage" })} />;
    return { title: defaultTitle, icon, behavior: { kind: "popover" as const, Content } };
  }

  function sync(id: string, agent: AgentPills) {
    for (const [kind, handle] of agent.handles) {
      if (configured.includes(kind)) continue;
      handle.remove();
      agent.handles.delete(kind);
    }
    for (const kind of configured) {
      if (agent.handles.has(kind)) continue;
      const button = createButton(kind);
      agent.handles.set(kind, client.addComposerPill({ id: `quota-${providers[kind].id}`, workspaceId: agent.workspaceId, agentId: id,
        button: { ...button, label: kind === "cpa" ? "Codex —" : providers[kind].label, ...captions.get(kind) } }));
    }
  }
  function onSettings(value: SettingsView) {
    settingsVersion++;
    configured = kinds.filter(kind => kind === "cpa" ? value.instances.length > 0 : kind === "claude" ? value.claude.enabled : value.display.showNativeProviders);
    for (const kind of kinds) if (!configured.includes(kind)) captions.delete(kind);
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
