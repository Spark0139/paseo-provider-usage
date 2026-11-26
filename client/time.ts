const minute = 60_000;
const day = 24 * 60 * minute;

/** All three representations use the same local calendar, including at DST boundaries. */
export function createLocalTime(timeZone?: string) {
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone, year: "numeric", month: "numeric", day: "numeric",
  });
  const clock = new Intl.DateTimeFormat("zh-CN", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const full = new Intl.DateTimeFormat("zh-CN", {
    timeZone, year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hourCycle: "h23", timeZoneName: "long",
  });
  const offset = new Intl.DateTimeFormat("zh-CN", { timeZone, timeZoneName: "shortOffset" });
  function calendarDay(value: number) {
    const parts = date.formatToParts(value);
    const part = (name: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === name)?.value);
    const year = part("year"), month = part("month"), dayOfMonth = part("day");
    return { year, month, dayOfMonth, index: Date.UTC(year, month - 1, dayOfMonth) / day };
  }
  return (iso: string, now: number) => {
    const instant = Date.parse(iso);
    if (!Number.isFinite(instant)) return null;
    const local = calendarDay(instant);
    const today = calendarDay(now);
    const relativeDay = local.index - today.index;
    const datePrefix = local.year === today.year ? "" : `${local.year}年`;
    const near = relativeDay === 0 ? "今天" : relativeDay === 1 ? "明天" : relativeDay === -1 ? "昨天" : null;
    const shortDate = near ?? `${datePrefix}${local.month}月${local.dayOfMonth}日`;
    const parts = full.formatToParts(instant);
    const zoneName = parts.find(p => p.type === "timeZoneName")!.value;
    const gmt = offset.formatToParts(instant).find(p => p.type === "timeZoneName")!.value;
    const zone = zoneName === gmt ? zoneName : `${zoneName}（${gmt}）`;
    const absolute = parts.filter(p => p.type !== "timeZoneName").map(p => p.value).join("").replace(/\s+/g, " ").trim();
    return { short: `${shortDate} ${clock.format(instant)}`, full: `${absolute} ${zone}` };
  };
}

export const localTime = createLocalTime();

export function resetCountdown(iso: string, now: number): string | null {
  const minutes = Math.ceil((Date.parse(iso) - now) / minute);
  if (!Number.isFinite(minutes)) return null;
  if (minutes <= 0) return "重置时间已过";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  if (days) return `${days}天${hours ? `${hours}小时` : ""}后`;
  if (hours) return `${hours}小时${remainder ? `${remainder}分` : ""}后`;
  return `${minutes}分钟后`;
}
