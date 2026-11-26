import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  clearSecretRpc, deleteInstanceRpc, overviewRpc, preferencesRpc, refreshKeeperRpc, saveInstanceRpc, settingsRpc, testInstanceRpc,
} from "../../shared/contracts";
import type { SourceSnapshot } from "../../shared/types";
import { SettingsStore } from "../storage/store";
import { UsageService } from "../usage/service";
import { createKeeperClient } from "../sources/keeper";
import { registerClaude } from "../sources/claude";
import { registerUsage } from "./usage";

export function registerPlugin(server: PluginServerContext, store: SettingsStore, options: {
  fetch?: typeof fetch;
  now?: () => Date;
  mockNative?: SourceSnapshot;
} = {}) {
  const send = options.fetch ?? fetch;
  // The shared React Native typings omit this Node 22 server API.
  const signals = AbortSignal as typeof AbortSignal & { any(values: AbortSignal[]): AbortSignal };
  const usage = new UsageService(store, (instance, password, lifetime) =>
    createKeeperClient(instance, password, {
      fetch: (input, init) => send(input, {
        ...init,
        signal: init?.signal ? signals.any([init.signal, lifetime]) : lifetime,
      }),
    }), options.now);
  const collector = registerClaude(server, {
    directory: store.directory, settings: () => store.claude,
    ingest: (windows, observedAt) => usage.claude.ingest(windows, observedAt),
  });
  const settings = () => store.view(usage.claude.snapshot().lastSuccessAt);
  registerUsage(server, usage.sources);
  server.handle(settingsRpc, settings);
  server.handle(saveInstanceRpc, draft => {
    store.save(draft);
    usage.prune();
    return settings();
  });
  server.handle(testInstanceRpc, async draft => ({ count: await usage.keeper.testInstance(draft) }));
  server.handle(deleteInstanceRpc, ({ id }) => {
    store.remove(id);
    usage.prune();
    return settings();
  });
  server.handle(clearSecretRpc, ({ id }) => {
    store.clearPassword(id);
    usage.prune();
    return settings();
  });
  server.handle(refreshKeeperRpc, ({ id }) => usage.keeper.requestRefresh(id));
  server.handle(preferencesRpc, input => {
    const previous = store.claude;
    store.preferences(input);
    if (previous.enabled !== store.claude.enabled || previous.providerId !== store.claude.providerId) {
      collector.invalidate();
      usage.prune();
    }
    return settings();
  });
  server.handle(overviewRpc, async ({ refresh }) => {
    const sources = await usage.overview(refresh);
    if (options.mockNative && store.display.showNativeProviders) sources.push(options.mockNative);
    return { sources, display: store.display, mock: Boolean(options.mockNative) };
  });
  return () => {
    collector.dispose();
    usage.keeper.dispose();
  };
}
