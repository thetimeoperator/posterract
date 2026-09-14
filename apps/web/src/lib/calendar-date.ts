/** Move by local dates, preserving midnight across 23- and 25-hour days. */
export function addCalendarDays(timestamp: number, days: number): number {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function startOfWeek(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return addCalendarDays(date.getTime(), -((date.getDay() + 6) % 7));
}

export function scheduleTimeForDay(day: number, now: number): number {
  const date = new Date(day);
  date.setHours(12, 0, 0, 0);
  return Math.max(date.getTime(), now + 30 * 60_000);
}

export function calendarDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function sameCalendarDay(left: number, right: number): boolean {
  return calendarDayKey(left) === calendarDayKey(right);
}

export function localDateTimeValue(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
