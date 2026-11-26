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

export function Button({ label, onPress, disabled = false, theme, danger = false }: {
  label: string; onPress: () => void; disabled?: boolean; theme: PluginTheme; danger?: boolean;
}) {
  const c = theme.colors;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6,
      borderColor: c.border, borderWidth: 1, opacity: disabled ? 0.55 : 1 }}>
    <Text style={{ color: danger ? c.statusDanger : c.foreground, fontWeight: "500" }}>{label}</Text>
  </Pressable>;
}

// Bar geometry and consumption thresholds adapted from Usage Monitor's UsageMeter.
export function RemainingBar({ used, theme }: { used: number; theme: PluginTheme }) {
  const filled = Math.max(0, Math.min(100, 100 - used));
  const c = theme.colors;
  const tone = used > 90 ? c.statusDanger : used >= 70 ? c.statusWarning : c.accent;
  return <View accessibilityRole="progressbar" accessibilityLabel="剩余额度"
    accessibilityValue={{ min: 0, max: 100, now: filled }} style={{ height: 5, borderRadius: 3,
      overflow: "hidden", backgroundColor: c.surface2 }}>
    <View style={{ height: "100%", width: `${filled}%`, backgroundColor: tone }} />
  </View>;
}
