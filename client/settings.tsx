import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  clearSecretRpc, deleteInstanceRpc, preferencesRpc, saveInstanceRpc, settingsRpc, testInstanceRpc,
  type SettingsView,
} from "../shared/contracts";
import { Button, Field } from "./controls";
import { overviewKey } from "./overview";
import { localDate } from "./usage";

type InstanceInfo = SettingsView["instances"][number];
type Notice = { text: string; error?: boolean };
type Run = (action: () => Promise<void>) => Promise<void>;
const actionRow = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;

function InstanceEditor({ instance, theme, busy, run, accept, notify, close }: {
  instance: InstanceInfo | null; theme: PluginTheme; busy: boolean; run: Run;
  accept: (value: SettingsView) => void; notify: (message: Notice) => void; close: () => void;
}) {
  const save = useRpc(saveInstanceRpc);
  const test = useRpc(testInstanceRpc);
  const clear = useRpc(clearSecretRpc);
  const remove = useRpc(deleteInstanceRpc);
  const [label, setLabel] = useState(instance?.label ?? "");
  const [url, setUrl] = useState(instance?.baseUrl ?? "");
  const [key, setKey] = useState("");
  const [confirm, setConfirm] = useState<"clear" | "remove" | null>(null);
  const draft = () => ({ id: instance?.id, label: label.trim(), baseUrl: url.trim(), key: key || undefined });
  const incomplete = !label.trim() || !url.trim() || (!instance?.hasSecret && !key.trim());
  return <View style={{ gap: 10, padding: 14 }}>
    <Field theme={theme} label="名称" value={label} onChange={setLabel} disabled={busy} />
    <Field theme={theme} label="CPA 管理地址" value={url} onChange={setUrl} disabled={busy} placeholder="https://cpa.example.com" />
    <Field theme={theme} label="管理密钥" value={key} onChange={setKey} disabled={busy} secret
      placeholder={instance?.hasSecret ? "留空保留当前密钥" : "输入 CPA 管理密钥"} />
    {instance && instance.baseUrl !== url.trim() && <Text style={{ color: theme.colors.foregroundMuted }}>
      更换主机时，请输入新主机的管理密钥。
    </Text>}
    <View style={actionRow}>
      <Button label="保存" theme={theme} disabled={busy || incomplete} onPress={() => void run(async () => {
        accept(await save(draft())); close(); notify({ text: "实例已保存" });
      })} />
      <Button label="测试连接" theme={theme} disabled={busy || incomplete} onPress={() => void run(async () => {
        const result = await test(draft());
        notify({ text: `连接成功，发现 ${result.count} 个 Codex 账号` });
      })} />
      <Button label="取消" theme={theme} disabled={busy} onPress={close} />
    </View>
    {instance && <View style={actionRow}>
      {instance.hasSecret && <Button label="清除已存密钥" theme={theme} disabled={busy} onPress={() => setConfirm("clear")} />}
      <Button label="移除实例" danger theme={theme} disabled={busy} onPress={() => setConfirm("remove")} />
    </View>}
    {instance && confirm && <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.foreground }}>{confirm === "remove"
        ? `从此插件移除「${instance.label}」及其密钥？` : `清除「${instance.label}」保存的密钥？`}</Text>
      <View style={actionRow}>
        <Button label="确认" danger theme={theme} disabled={busy} onPress={() => void run(async () => {
          const value = confirm === "remove" ? await remove({ id: instance.id }) : await clear({ id: instance.id });
          accept(value); close(); notify({ text: confirm === "remove" ? "实例已移除" : "密钥已清除" });
        })} />
        <Button label="返回" theme={theme} disabled={busy} onPress={() => setConfirm(null)} />
      </View>
    </View>}
  </View>;
}

function ClaudeOptions({ settings, theme, busy, run, accept }: {
  settings: SettingsView; theme: PluginTheme; busy: boolean; run: Run; accept: (settings: SettingsView) => void;
}) {
  const change = useRpc(preferencesRpc);
  const [providerId, setProviderId] = useState(settings.claude.providerId);
  const provider = providerId.trim();
  const changed = provider !== settings.claude.providerId;
  const valid = /^[a-z0-9][a-z0-9._-]{0,99}$/.test(provider);
  const update = (enabled: boolean) => void run(async () => {
    accept(await change({ claude: { enabled, providerId: provider } }));
  });
  return <SettingsSection title="Claude Code">
    <SettingsCard>
      <SettingsSwitch label="被动采集 SDK 额度" hint="读取此 Provider 正常推理时上报的额度事件。"
        value={settings.claude.enabled} disabled={busy || !valid} onValueChange={update} />
      <View style={{ gap: 8, padding: 14 }}>
        <Field label="运行 Claude Code 的 Provider ID" onChange={setProviderId} value={providerId} theme={theme} disabled={busy} />
        {changed && <Button label="保存 Provider ID" theme={theme} disabled={busy || !valid}
          onPress={() => update(settings.claude.enabled)} />}
      </View>
      <SettingsRow label="采集状态" hint={!settings.claude.enabled ? "已关闭" : settings.claudeObservedAt
        ? `最近采集 ${localDate(settings.claudeObservedAt)}` : "等待首次额度事件"} />
    </SettingsCard>
  </SettingsSection>;
}

function HostSettings({ theme, host }: PluginSurfaceProps) {
  const read = useRpc(settingsRpc);
  const preferences = useRpc(preferencesRpc);
  const cache = useQueryClient();
  const queryKey = ["provider-usage", host.id, "settings"] as const;
  const result = useQuery({ queryKey, queryFn: () => read({}), retry: false, refetchOnWindowFocus: false });
  const settings = result.data;
  const [editing, setEditing] = useState<InstanceInfo | "new" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const c = theme.colors;
  function accept(value: SettingsView) {
    cache.setQueryData(queryKey, value);
    void cache.invalidateQueries({ queryKey: overviewKey(host.id) });
  }
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setNotice(null);
    try { await action(); }
    catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "请求失败，请重试。", error: true });
    } finally { locked.current = false; setBusy(false); }
  }
  function edit(instance: InstanceInfo | "new" | null) {
    setNotice(null); setEditing(instance);
  }
  if (!settings) return <View style={{ gap: 8 }}>
    <Text style={{ color: c.foregroundMuted }}>{result.isError ? "无法读取设置。" : "正在读取设置…"}</Text>
    {result.isError && <Button label="重试" theme={theme} onPress={() => void result.refetch()} />}
  </View>;
  return <View style={{ gap: 18 }}>
    <SettingsSection title="CPA 实例" trailing={<Button label="添加实例" theme={theme}
      disabled={busy || editing !== null} onPress={() => edit("new")} />}>
      <SettingsCard>
        {!settings.instances.length && !editing && <SettingsRow label="暂无 CPA 实例" hint="添加实例后，插件将发现其中的 Codex 账号。" />}
        {settings.instances.map(instance => <SettingsRow key={instance.id} label={instance.label}
          hint={`${instance.baseUrl} · ${instance.hasSecret ? "已设置密钥" : "未设置密钥"}`}>
          <Button label="编辑" theme={theme} disabled={busy || editing !== null} onPress={() => edit(instance)} />
        </SettingsRow>)}
        {editing && <InstanceEditor key={editing === "new" ? "new" : editing.id} instance={editing === "new" ? null : editing}
          theme={theme} busy={busy} run={run} notify={setNotice} accept={accept} close={() => edit(null)} />}
      </SettingsCard>
    </SettingsSection>
    {notice && <Text accessibilityLiveRegion="polite" style={{ color: notice.error ? c.statusDanger : c.foreground }}>{notice.text}</Text>}
    <ClaudeOptions key={settings.claude.providerId} settings={settings} theme={theme} busy={busy} run={run} accept={accept} />
    <SettingsSection title="显示">
      <SettingsCard>
        {([["showDisabledAccounts", "显示停用账号"], ["showNativeProviders", "显示 Antigravity 原生额度"],
          ["showResetCountdown", "显示重置倒计时"]] as const).map(([key, label]) =>
          <SettingsSwitch key={key} label={label} value={settings.display[key]} disabled={busy}
            onValueChange={value => void run(async () => accept(await preferences({ display: { [key]: value } })))} />)}
      </SettingsCard>
    </SettingsSection>
  </View>;
}

export function Settings(props: PluginSurfaceProps) {
  return <HostSettings key={props.host.id} {...props} />;
}
