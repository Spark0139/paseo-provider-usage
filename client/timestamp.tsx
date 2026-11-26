import type { PluginTheme } from "@getpaseo/plugin";
import { Text } from "react-native";
import { localTime, resetCountdown } from "./time";

type TimestampProps = {
  iso: string; now: number; label: string; theme: PluginTheme;
  countdown?: boolean; alignEnd?: boolean;
};

export function Timestamp({ iso, now, label, theme, countdown, alignEnd }: TimestampProps) {
  const timestamp = localTime(iso, now);
  const timeLeft = countdown && timestamp ? resetCountdown(iso, now) : null;
  const suffix = timeLeft ? ` · ${timeLeft}` : "";
  return <Text accessibilityLabel={timestamp ? `${label} ${timestamp.full}${suffix}` : undefined}
    style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums"],
      textAlign: alignEnd ? "right" : "left", maxWidth: "100%", flexShrink: 1, paddingVertical: 2 }}>
    {label} {timestamp?.short ?? "—"}{suffix}
  </Text>;
}
