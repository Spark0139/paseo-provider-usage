import type { PluginTheme } from "@getpaseo/plugin";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { localTime, resetCountdown } from "./time";

type TimestampProps = {
  iso: string; now: number; label: string; theme: PluginTheme;
  countdown?: boolean; alignEnd?: boolean;
};

export function Timestamp({ iso, now, label, theme, countdown, alignEnd }: TimestampProps) {
  const timestamp = localTime(iso, now);
  const title = timestamp ? `${label} ${timestamp.full}` : "";
  // Adapted from Usage Monitor's setTooltipTitle. RN Web drops a JSX title prop.
  const setTitle = useCallback((node: unknown) => {
    if (node && typeof node === "object" && "setAttribute" in node && typeof node.setAttribute === "function") {
      node.setAttribute("title", title);
    }
  }, [title]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || focused || pinned;
  const c = theme.colors;
  const timeLeft = countdown && timestamp ? resetCountdown(iso, now) : null;
  return <View style={{ alignItems: alignEnd ? "flex-end" : "flex-start", maxWidth: "100%", zIndex: open ? 1 : 0 }}>
    <Pressable ref={setTitle} disabled={!timestamp} accessibilityRole="button" accessibilityLabel={title}
      accessibilityState={{ expanded: open }} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setPinned(false); }}
      onPress={() => {
        if (pinned) { setFocused(false); setHovered(false); }
        setPinned(!pinned);
      }} style={{ paddingVertical: 2 }}>
      <Text style={{ color: c.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums"] }}>
        {label} {timestamp?.short ?? "—"}{timeLeft ? ` · ${timeLeft}` : ""}
      </Text>
    </Pressable>
    {open && timestamp && <View pointerEvents="none" style={{ position: "absolute", bottom: "100%",
      ...(alignEnd ? { right: 0 } : { left: 0 }), width: 245, paddingHorizontal: 10, paddingVertical: 7,
      backgroundColor: c.foreground, borderRadius: 6 }}>
      <Text style={{ color: c.surface0, fontSize: 12 }}>{title}</Text>
    </View>}
  </View>;
}
