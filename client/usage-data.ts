import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { claudeSnapshotRpc, keeperRefreshStatusRpc, overviewRpc, refreshKeeperRpc, type KeeperRefreshStatus } from "../shared/contracts";
import { antigravitySnapshot } from "../shared/native-usage";
import type { ProviderKind } from "../shared/providers";

export const claudeSnapshotKey = (host: string) => ["provider-usage", host, "claude-snapshot"] as const;
export const overviewKey = (host: string) => ["provider-usage", host, "overview"] as const;
const onDemand = { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
type Surface = "dashboard" | "codex-rail" | "settings" | ProviderKind;

function subscribeToAppState(notify: () => void) {
  const subscription = AppState.addEventListener("change", notify);
  return () => subscription.remove();
}
const appIsActive = () => AppState.currentState !== "background" && AppState.currentState !== "inactive";

export function useAppActive() {
  return useSyncExternalStore(subscribeToAppState, appIsActive, appIsActive);
}

export function useOverview(host: string, surface: Surface, visible = true) {
  const active = useAppActive();
  const read = useRpc(overviewRpc);
  const overview = useQuery({
    queryKey: overviewKey(host), queryFn: () => read({}), ...onDemand,
    enabled: active && visible, staleTime: 15_000, refetchOnMount: true,
    refetchInterval: active && visible && (surface === "dashboard" || surface === "cpa" || surface === "codex-rail") ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
  return { active, read, overview };
}

export function useClaudeSnapshot(host: string, enabled: boolean) {
  const read = useRpc(claudeSnapshotRpc);
  return useQuery({
    queryKey: claudeSnapshotKey(host), queryFn: () => read({}), ...onDemand,
    enabled, staleTime: 10_000, refetchInterval: enabled ? 10_000 : false, refetchIntervalInBackground: false,
  });
}

export function useUsage(host: string, surface: "dashboard" | ProviderKind, visible = true) {
  const { active, read, overview } = useOverview(host, surface);
  const paseo = usePaseo();
  const cache = useQueryClient();
  const wantsClaude = surface === "claude";
  const claude = useClaudeSnapshot(host, active && visible && wantsClaude);
  const view = overview.data;
  const wantsNative = surface === "dashboard" || surface === "native";
  const nativeEnabled = active && !!view && !view.mock && view.display.showNativeProviders && wantsNative;
  const native = useQuery({
    queryKey: ["provider-usage", host, "antigravity"],
    queryFn: async () => antigravitySnapshot(await paseo.providers.listUsage()),
    enabled: nativeEnabled, staleTime: 60_000, ...onDemand,
  });
  const reload = useMutation({
    mutationFn: async () => {
      if (surface === "dashboard") {
        await cache.cancelQueries({ queryKey: overviewKey(host) });
        cache.setQueryData(overviewKey(host), await read({ refresh: true }));
      } else if (wantsClaude) {
        await Promise.all([claude.refetch(), !view && overview.refetch()]);
      } else {
        await overview.refetch();
      }
      if (nativeEnabled) await native.refetch();
    },
    retry: false,
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [active, surface]);
  const sources = wantsClaude ? (claude.data ? [claude.data] : [])
    : (view?.sources ?? []).filter(source => source.kind !== "native" || view?.display.showNativeProviders);
  if (view?.display.showNativeProviders && !view.mock && native.data) sources.push(native.data);
  return { overview, view, claude, native, nativeEnabled, sources, refresh: () => reload.mutate(),
    refreshError: reload.isError, busy: reload.isPending || overview.isFetching || (wantsClaude && claude.isFetching) || (nativeEnabled && native.isFetching), now };
}

export function useKeeperUpdate(host: string, id: string, visible: boolean) {
  const cache = useQueryClient();
  const active = useAppActive();
  const submit = useRpc(refreshKeeperRpc);
  const read = useRpc(keeperRefreshStatusRpc);
  const queryKey = ["provider-usage", host, "keeper-update", id] as const;
  const status = useQuery({
    queryKey, enabled: visible && active, ...onDemand,
    queryFn: async () => {
      const previous = cache.getQueryData<KeeperRefreshStatus>(queryKey);
      const next = await read({ id });
      if ((next.phase === "completed" || next.phase === "unconfirmed") && previous?.phase !== next.phase) {
        // Keeper has already reread this instance; the ordinary overview uses that snapshot.
        await cache.invalidateQueries({ queryKey: overviewKey(host) });
      }
      return next;
    },
    refetchIntervalInBackground: false,
    refetchInterval: query => query.state.data?.phase === "pending" ? 4_000 : false,
  });
  const update = useMutation({
    mutationFn: () => submit({ id }), retry: false,
    onSuccess: async receipt => {
      await cache.cancelQueries({ queryKey });
      cache.setQueryData<KeeperRefreshStatus>(queryKey, {
        phase: "pending", completed: 0, failed: receipt.failed, remaining: receipt.queued + receipt.pending,
      });
      await cache.invalidateQueries({ queryKey });
    },
  });
  const result = status.data;
  let message: string | undefined;
  if (update.isError) message = "提交更新失败";
  else if (status.isError) message = "暂时无法读取更新状态";
  else if (result?.phase === "pending") message = `正在更新 · 剩余 ${result.remaining}`;
  else if (result?.phase === "unconfirmed") message = "部分任务的结果尚未确认";
  else if (result?.phase === "completed" && result.error) message = "任务已结束，最新额度尚未读到";
  else if (result?.phase === "completed") message = result.failed
    ? `更新结束 · 成功 ${result.completed} · 失败 ${result.failed}`
    : result.completed ? `已更新 ${result.completed} 个账号` : "没有可更新的账号";
  return { submit: () => update.mutate(), submitting: update.isPending, pending: result?.phase === "pending", message,
    warning: update.isError || status.isError || !!result?.error || result?.phase === "unconfirmed" || !!result?.failed };
}
