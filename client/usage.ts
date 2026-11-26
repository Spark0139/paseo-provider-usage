export { antigravitySnapshot } from "../shared/native-usage";

export function localDate(iso: string, locale?: string, timeZone?: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone,
  }).format(date);
}

export function countdown(iso: string, now: number): string {
  const minutes = Math.ceil((Date.parse(iso) - now) / 60_000);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes <= 0) return "重置时间已过";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days} 天 ${hours} 小时后`;
  if (hours) return `${hours} 小时 ${minutes % 60} 分钟后`;
  return `${minutes} 分钟后`;
}
