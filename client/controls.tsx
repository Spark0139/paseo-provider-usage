import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, TextInput, View } from "react-native";

// Adapted from Usage Monitor's settings Field and action button (see THIRD_PARTY_NOTICES.md).
export function Field({ label, value, onChange, theme, secret = false, disabled = false, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; theme: PluginTheme;
  secret?: boolean; disabled?: boolean; placeholder?: string;
}) {
  const c = theme.colors;
  return <View style={{ gap: 5 }}>
    <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{label}</Text>
    <TextInput accessibilityLabel={label} autoCapitalize="none" autoCorrect={false}
      editable={!disabled} onChangeText={onChange} value={value} placeholder={placeholder}
      placeholderTextColor={c.foregroundMuted} secureTextEntry={secret} autoComplete="off"
      style={{ color: c.foreground, borderColor: c.border, borderWidth: 1, borderRadius: 6, padding: 9 }} />
  </View>;
}

export function Button({ label, onPress, disabled = false, theme, danger = false, small = false }: {
  label: string; onPress: () => void; disabled?: boolean; theme: PluginTheme; danger?: boolean;
  small?: boolean;
}) {
  const c = theme.colors;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => ({ paddingVertical: small ? 5 : 8, paddingHorizontal: small ? 9 : 12,
      borderRadius: 6, borderColor: c.border, borderWidth: 1, backgroundColor: pressed ? c.surface2 : c.surface0,
      opacity: disabled ? 0.55 : 1 })}>
    <Text style={{ color: danger ? c.statusDanger : c.foreground, fontSize: small ? 12 : 14, fontWeight: "500" }}>{label}</Text>
  </Pressable>;
}

// Bar-only branch of Usage Monitor's UsageMeter in client/meter.client.tsx.
export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function UsageMeter({ percentUsed, percentFilled, pacePercent, theme, compact }: {
  percentUsed: number; percentFilled: number; pacePercent: number | null; theme: PluginTheme; compact: boolean;
}) {
  const fill = clampPercent(percentFilled);
  const height = compact ? 4 : 6;
  const borderRadius = height / 2;
  const c = theme.colors;
  const tone = percentUsed > 90 ? c.statusDanger : percentUsed >= 70 ? c.statusWarning : c.accent;
  return <View accessibilityRole="progressbar" accessibilityLabel="剩余额度"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill}
    style={{ height, borderRadius, overflow: "hidden", backgroundColor: c.surface2 }}>
    <View style={{ height, borderRadius, width: `${fill}%`, backgroundColor: tone }} />
    {pacePercent !== null && <View style={{ position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -1,
      left: `${clampPercent(pacePercent)}%`, backgroundColor: c.foregroundMuted }} />}
  </View>;
}
