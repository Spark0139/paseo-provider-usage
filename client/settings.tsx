import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import { ExternalLink, SettingsCard, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  claudeDiagnosticsRpc, clearSecretRpc, deleteInstanceRpc, preferencesRpc, saveInstanceRpc, settingsRpc, testInstanceRpc,
  type SettingsView,
} from "../shared/contracts";
import { providers } from "../shared/providers";
import type { CodexAccountRef } from "../shared/types";
import { accountKey, codexAccounts, displayedCodexAccount } from "./codex-account";
import { Button, Field } from "./controls";
import { overviewKey, useAppActive, useOverview } from "./usage-data";
import { Timestamp } from "./timestamp";

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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState<"clear" | "remove" | null>(null);
  const draft = () => ({ id: instance?.id, label: label.trim(), baseUrl: url.trim(), password: password || undefined });
  const incomplete = !label.trim() || !url.trim();
  return <View style={{ gap: 10, padding: 14 }}>
    <Field theme={theme} label="名称" value={label} onChange={setLabel} disabled={busy} />
    <Field theme={theme} label="Keeper 地址" value={url} onChange={setUrl} disabled={busy} placeholder="https://keeper.example.com" />
    <Field theme={theme} label="Keeper 登录密码（可选）" value={password} onChange={setPassword} disabled={busy} secret
      placeholder={instance?.hasPassword && instance.baseUrl === url.trim() ? "留空保留已存密码" : "免登录实例可留空"} />
    {instance && instance.baseUrl !== url.trim() && <Text style={{ color: theme.colors.foregroundMuted }}>
      更换地址或路径时，如需登录，请重新输入该实例的密码。
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
      {instance.hasPassword && <Button label="清除已存密码" theme={theme} disabled={busy} onPress={() => setConfirm("clear")} />}
      <Button label="移除实例" danger theme={theme} disabled={busy} onPress={() => setConfirm("remove")} />
    </View>}
    {instance && confirm && <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.foreground }}>{confirm === "remove"
        ? `从此插件移除「${instance.label}」及其密码？` : `清除「${instance.label}」保存的密码？`}</Text>
      <View style={actionRow}>
        <Button label="确认" danger theme={theme} disabled={busy} onPress={() => void run(async () => {
          const value = confirm === "remove" ? await remove({ id: instance.id }) : await clear({ id: instance.id });
          accept(value); close(); notify({ text: confirm === "remove" ? "实例已移除" : "密码已清除" });
        })} />
        <Button label="返回" theme={theme} disabled={busy} onPress={() => setConfirm(null)} />
      </View>
    </View>}
  </View>;
}

function CodexAccountPicker({ hostId, preferred, busy, onChange }: {
  hostId: string; preferred: CodexAccountRef | null; busy: boolean; onChange(value: CodexAccountRef | null): void;
}) {
  const { overview } = useOverview(hostId, "settings");
  const accounts = codexAccounts(overview.data?.sources ?? []);
  const selected = displayedCodexAccount(accounts, preferred);
  const options = [{ label: "自动", value: "auto" }, ...accounts.filter(row => row.account.enabled === true)
    .map(row => ({ label: row.label, value: row.key }))];
  const value = preferred ? accountKey(preferred) : "auto";
  if (preferred && !options.some(option => option.value === value)) {
    const label = selected ? `${selected.label}（${selected.account.enabled === false ? "已停用" : "启用状态未知"}）` : "所选账号暂不可用";
    options.push({ label, value });
  }
  const hint = overview.isLoading ? "正在读取 Keeper 账号…" : overview.isError ? "暂时无法读取 Keeper 账号。"
    : selected ? `${selected.label} · ${selected.window ? "输入框显示此账号的剩余额度" : "暂无可显示的额度"}`
    : preferred ? "所选账号暂不可用，输入框显示 —。" : "尚无已启用的账号。";
  return <SettingsSelect label="常用账号" hint={hint} value={value} options={options} disabled={busy}
    onValueChange={key => {
      if (key === value) return;
      if (key === "auto") onChange(null);
      else {
        const option = accounts.find(row => row.key === key);
        if (option) onChange(option.ref);
      }
    }} />;
}

const claudeStages = {
  disabled: "已关闭",
  waitingSession: "等待会话使用所选配置启动",
  sessionOpened: "会话已匹配，尚未收到启动器连接",
  connected: "启动器已连接，等待额度事件",
  observed: "已收到额度事件",
  receiverError: "插件无法打开本地采集通道",
} as const;

function ClaudeOptions({ settings, hostId, theme, busy, run, accept }: {
  settings: SettingsView; hostId: string; theme: PluginTheme; busy: boolean; run: Run; accept: (settings: SettingsView) => void;
}) {
  const change = useRpc(preferencesRpc);
  const inspect = useRpc(claudeDiagnosticsRpc);
  const active = useAppActive();
  const { enabled, providerId } = settings.claude;
  const diagnostics = useQuery({
    queryKey: ["provider-usage", hostId, "claude-diagnostics", providerId, enabled], queryFn: () => inspect({}),
    enabled: active, retry: false, refetchOnWindowFocus: false, refetchIntervalInBackground: false,
    refetchInterval: query => active && enabled && query.state.data?.stage !== "observed" ? 10_000 : false,
  });
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(providerId);
  const provider = draft.trim();
  const valid = /^[a-z0-9][a-z0-9._-]{0,99}$/.test(provider);
  const update = (enabled: boolean, providerId: string) => void run(async () => {
    accept(await change({ claude: { enabled, providerId } }));
    setCustom(false);
  });
  const result = diagnostics.data;
  const options = (result?.providers ?? []).map(option => ({ label: option.label, value: option.id }));
  if (!options.some(option => option.value === providerId)) options.push({ label: providerId, value: providerId });
  options.push({ label: "手动输入配置 ID…", value: "@manual" });
  const stage = !enabled ? "disabled" : result?.stage;
  const title = stage ? claudeStages[stage] : diagnostics.isError ? "暂时无法读取接入状态" : "正在检查接入状态…";
  const setup = stage === "waitingSession" || stage === "sessionOpened";
  const launchHint = result?.launcher === "listed" ? "启动命令已包含采集启动器。"
    : result?.launcher === "unlisted" ? "当前启动命令中未列出 claude-launch.cjs。若通过自己的脚本启动，请确认脚本已调用它。"
    : "请确认此启动配置会通过 claude-launch.cjs 运行现有的 Claude 命令。";
  const next = stage === "waitingSession" ? "应用配置后，等当前回合结束，在原 Chat 的标签页菜单选择「重新加载 Agent」，即可保留历史。也可以用此配置新建 Chat。随后正常发一条消息。"
    : stage === "sessionOpened" ? "应用启动命令后，重新打开使用此配置的会话。"
    : stage === "connected" ? "在这个会话正常使用 Claude；它上报额度后会在这里显示。"
    : stage === "receiverError" ? "检查插件数据目录的写入权限，重新加载插件后再打开会话。" : null;
  const observed = result?.observedAt ?? settings.claudeObservedAt;
  const c = theme.colors;
  return <SettingsSection title={providers.claude.label}>
    <SettingsCard>
      <SettingsSwitch label="采集额度" value={enabled} disabled={busy || custom}
        onValueChange={value => update(value, providerId)} />
      <SettingsSelect label="采集哪个 Claude 启动配置" hint="选择你在 Paseo 中新建 Claude 会话时使用的配置。"
        value={custom ? "@manual" : providerId} options={options} disabled={busy}
        onValueChange={id => {
          if (id === "@manual") { setDraft(providerId); setCustom(true); }
          else if (id !== providerId) update(enabled, id);
          else setCustom(false);
        }} />
      {custom && <View style={{ gap: 8, padding: 14 }}>
        <Field label="启动配置 ID" onChange={setDraft} value={draft} theme={theme} disabled={busy} />
        <View style={actionRow}>
          <Button label="保存" theme={theme} disabled={busy || !valid} onPress={() => update(enabled, provider)} />
          <Button label="取消" theme={theme} disabled={busy} onPress={() => setCustom(false)} />
        </View>
      </View>}
      <SettingsRow label="采集状态" hint={title}>
        {enabled && <Button label="检查接入" small theme={theme} disabled={busy || diagnostics.isFetching}
          onPress={() => void diagnostics.refetch()} />}
      </SettingsRow>
      {enabled && (next || observed) && <View style={{ gap: 7, paddingHorizontal: 14, paddingBottom: 12 }}>
        {setup && <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{launchHint}</Text>}
        {next && <Text style={{ color: c.foreground, fontSize: 13 }}>{next}</Text>}
        {setup && result?.launcher !== "listed" && <ExternalLink href="https://github.com/Spark0139/paseo-provider-usage/blob/main/docs/claude-collection.md">
          <Text style={{ color: c.accent, fontSize: 13 }}>查看启动器配置示例</Text>
        </ExternalLink>}
        {observed && <Timestamp iso={observed} now={Date.now()} label={stage === "observed" ? "最近采集" : "上次记录"} theme={theme} />}
      </View>}
    </SettingsCard>
  </SettingsSection>;
}

type SettingsProps = PluginSurfaceProps & { onSaved: (value: SettingsView) => void };

function HostSettings({ theme, host, onSaved }: SettingsProps) {
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
    onSaved(value);
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
  function changeDisplay(key: keyof SettingsView["display"], value: boolean) {
    void run(async () => accept(await preferences({ display: { [key]: value } })));
  }
  function edit(instance: InstanceInfo | "new" | null) {
    setNotice(null); setEditing(instance);
  }
  if (!settings) return <View style={{ gap: 8 }}>
    <Text style={{ color: c.foregroundMuted }}>{result.isError ? "无法读取设置。" : "正在读取设置…"}</Text>
    {result.isError && <Button label="重试" theme={theme} onPress={() => void result.refetch()} />}
  </View>;
  return <View style={{ gap: 18 }}>
    <SettingsSection title={providers.cpa.label} trailing={<Button label="添加 Keeper 实例" theme={theme}
      disabled={busy || editing !== null} onPress={() => edit("new")} />}>
      <SettingsCard>
        {!settings.instances.length && !editing && <SettingsRow label="暂无 Keeper 实例" />}
        {settings.instances.map(instance => <SettingsRow key={instance.id} label={instance.label}
          hint={`${instance.baseUrl} · ${instance.hasPassword ? "已存登录密码" : "未存登录密码"}`}>
          <Button label="编辑" theme={theme} disabled={busy || editing !== null} onPress={() => edit(instance)} />
        </SettingsRow>)}
        {editing && <InstanceEditor key={editing === "new" ? "new" : editing.id} instance={editing === "new" ? null : editing}
          theme={theme} busy={busy} run={run} notify={setNotice} accept={accept} close={() => edit(null)} />}
        {(settings.instances.length > 0 || settings.codexAccount) && <CodexAccountPicker hostId={host.id} preferred={settings.codexAccount}
          busy={busy} onChange={codexAccount => void run(async () => accept(await preferences({ codexAccount })))} />}
        <SettingsSwitch label="显示停用账号" value={settings.display.showDisabledAccounts} disabled={busy}
          onValueChange={value => changeDisplay("showDisabledAccounts", value)} />
      </SettingsCard>
    </SettingsSection>
    {notice && <Text accessibilityLiveRegion="polite" style={{ color: notice.error ? c.statusDanger : c.foreground }}>{notice.text}</Text>}
    <ClaudeOptions key={settings.claude.providerId} hostId={host.id} settings={settings} theme={theme} busy={busy} run={run} accept={accept} />
    <SettingsSection title={providers.native.label}>
      <SettingsCard>
        <SettingsSwitch label="显示额度" value={settings.display.showNativeProviders} disabled={busy}
          onValueChange={value => changeDisplay("showNativeProviders", value)} />
      </SettingsCard>
    </SettingsSection>
    <SettingsCard>
      <SettingsSwitch label="显示重置倒计时" value={settings.display.showResetCountdown} disabled={busy}
        onValueChange={value => changeDisplay("showResetCountdown", value)} />
    </SettingsCard>
  </View>;
}

export function Settings(props: SettingsProps) {
  return <HostSettings key={props.host.id} {...props} />;
}
