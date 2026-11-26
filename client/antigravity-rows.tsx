import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { antigravityGroups, type CatalogModel } from "../shared/antigravity-models";
import type { QuotaWindow } from "../shared/types";
import { productIcons } from "./product-icons";
import { WindowRow, windowLabel, type RowProps } from "./window-row";

export function AntigravityCatalog({ models, theme, title = "可用模型" }: {
  models: CatalogModel[]; theme: PluginTheme; title?: string;
}) {
  if (!models.length) return null;
  return <View style={{ paddingVertical: 5, gap: 4 }}>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{title}</Text>
    <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{models.map(model => model.label).join("、")}</Text>
  </View>;
}

export function AntigravityRows({ windows, models, ...row }: RowProps & { windows: QuotaWindow[]; models?: CatalogModel[] }) {
  const { groups, unlisted } = antigravityGroups(windows, models);
  const c = row.theme.colors;
  return <View>
    {groups.map(({ name, shared, models, windows }, index) => {
      const title = !shared && models.length === 1 ? models[0].label : name;
      return <View key={name} style={{ paddingVertical: 3, borderTopWidth: index ? 1 : 0, borderColor: c.border }}>
        {title.length > 0 && <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {/^gemini\b/i.test(title) && <Icon icon={productIcons.gemini} size={14} color={c.foreground} />}
          <Text accessibilityRole="header" style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>{title}</Text>
          {shared && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>共享额度</Text>}
        </View>}
        {models.length > 0 && (shared || models.length > 1) &&
          <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{models.map(model => model.label).join("、")}</Text>}
        {windows.map(({ window, period, disabled }) => <WindowRow key={window.id} window={window}
          label={windowLabel({ ...window, label: period }) + (disabled ? " · 已停用" : "")} {...row} />)}
      </View>;
    })}
    <AntigravityCatalog models={unlisted} theme={row.theme} title="未单列额度" />
  </View>;
}
