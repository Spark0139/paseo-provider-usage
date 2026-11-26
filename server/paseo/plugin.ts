import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  clearSecretRpc, deleteInstanceRpc, overviewRpc, preferencesRpc, saveInstanceRpc, settingsRpc, testInstanceRpc,
} from "../../shared/contracts";
import type { SourceSnapshot } from "../../shared/types";
import { SettingsStore } from "../storage/store";
import { UsageService } from "../usage/service";
import { pullCpa, testCpa } from "../sources/cpa";
import { registerClaude } from "../sources/claude";
import { registerUsage } from "./usage";

export function registerPlugin(server: PluginServerContext, store: SettingsStore, options: {
  fetch?: typeof fetch;
  now?: () => Date;
  mockNative?: SourceSnapshot;
} = {}) {
  const usage = new UsageService(store, (instance, key) => pullCpa(instance, key, options), options.now);
  const collector = registerClaude(server, {
    directory: store.directory, settings: () => store.claude,
    ingest: (windows, observedAt) => usage.ingest(windows, observedAt),
  });
  const settings = () => store.view(usage.claudeSnapshot().lastSuccessAt);
  registerUsage(server, usage);
  server.handle(settingsRpc, settings);
  server.handle(saveInstanceRpc, draft => {
    store.save(draft);
    usage.prune();
    return settings();
  });
  server.handle(testInstanceRpc, async draft => {
    const { instance, key } = store.resolve(draft);
    return { count: await testCpa(instance, key, options) };
  });
  server.handle(deleteInstanceRpc, ({ id }) => {
    store.remove(id);
    usage.prune();
    return settings();
  });
  server.handle(clearSecretRpc, ({ id }) => {
    store.remove(id, true);
    usage.prune();
    return settings();
  });
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
  return () => collector.dispose();
}
