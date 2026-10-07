/** Numbers the way the Points tab writes them. */

export function formatPoints(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatWhole(value: number) {
  return Math.round(value).toLocaleString();
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 0,
  }).format(value);
}

export function relativeTime(timestamp: number) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 10_080) return `${Math.round(minutes / 1440)}d ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}
