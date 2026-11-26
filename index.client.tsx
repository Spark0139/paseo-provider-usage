import type { PluginClientContext, PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Overview } from "./client/overview";
import { Settings } from "./client/settings";

// Sidebar-to-screen registration adapted from Paseo Usage Monitor.
function UsageItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Gauge" active={currentScreen?.screenId === "usage"}
    onPress={() => openScreen({ screenId: "usage" })} />;
}
export default function contribute(client: PluginClientContext) {
  function UsageScreen(props: PluginScreenProps) {
    return <Overview key={props.host.id} {...props} openSettings={() => client.openSettings("settings")} />;
  }
  client.addScreen({ id: "usage", title: "Provider Usage", Component: UsageScreen });
  client.addSidebarHeaderItem({ id: "usage", title: "Provider Usage", Component: UsageItem });
  client.addSettingsScreen({ id: "settings", title: "Provider Usage", icon: "Settings2", Component: Settings });
  return () => {};
}
