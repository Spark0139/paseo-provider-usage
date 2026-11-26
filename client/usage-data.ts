import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { keeperRefreshStatusRpc, overviewRpc, refreshKeeperRpc, type KeeperRefreshStatus } from "../shared/contracts";
import { antigravitySnapshot } from "../shared/native-usage";
import type { ProviderKind } from "../shared/providers";

export const overviewKey = (host: string) => ["provider-usage", host, "overview"] as const;
const onDemand = { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
type Surface = "dashboard" | "rail" | ProviderKind;

function subscribeToAppState(notify: () => void) {
  const subscription = AppState.addEventListener("change", notify);
  return () => subscription.remove();
}
const appIsActive = () => AppState.currentState !== "background" && AppState.currentState !== "inactive";

export function useUsage(host: string, surface: Surface) {
  const active = useSyncExternalStore(subscribeToAppState, appIsActive, appIsActive);
  const read = useRpc(overviewRpc);
  const paseo = usePaseo();
  const cache = useQueryClient();
  const overview = useQuery({
    queryKey: overviewKey(host), queryFn: () => read({}), ...onDemand,
    enabled: active, staleTime: 15_000, refetchOnMount: surface !== "rail",
    refetchInterval: active && (surface === "dashboard" || surface === "cpa") ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
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
      } else {
        await overview.refetch();
      }
      if (nativeEnabled) await native.refetch();
    },
    retry: false,
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active || surface === "rail") return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [active, surface]);
  const sources = (view?.sources ?? []).filter(source => source.kind !== "native" || view?.display.showNativeProviders);
  if (view?.display.showNativeProviders && !view.mock && native.data) sources.push(native.data);
  return { overview, view, native, nativeEnabled, sources, refresh: () => reload.mutate(), refreshError: reload.isError, busy: reload.isPending || overview.isFetching || (nativeEnabled && native.isFetching), now };
}

export function useKeeperUpdate(host: string, id: string, visible: boolean) {
  const cache = useQueryClient();
  const active = useSyncExternalStore(subscribeToAppState, appIsActive, appIsActive);
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
  else if (result?.phase === "unconfirmed") message = "已重读缓存，部分任务状态未确认";
  else if (result?.phase === "completed" && result.error) message = "任务已结束，最新额度尚未读到";
  else if (result?.phase === "completed") message = result.failed
    ? `更新结束 · 成功 ${result.completed} · 失败 ${result.failed}`
    : `已更新 ${result.completed} 个账号`;
  return { submit: () => update.mutate(), submitting: update.isPending, pending: result?.phase === "pending", message,
    warning: update.isError || status.isError || !!result?.error || result?.phase === "unconfirmed" || !!result?.failed };
}
