import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerPlugin } from "./server/paseo/plugin";
import { SettingsStore } from "./server/storage/store";

export default function contribute(server: PluginServerContext) {
  const home = process.env.PASEO_HOME || "~/.paseo";
  const root = home === "~" ? homedir() : home.startsWith("~/") ? join(homedir(), home.slice(2)) : resolve(home);
  return registerPlugin(server, new SettingsStore(join(root, "provider-usage")));
}
