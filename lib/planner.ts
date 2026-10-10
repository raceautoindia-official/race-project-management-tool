/**
 * The daily / weekly planner: pure rules about which day a planner entry
 * belongs to, and which days a week covers.
 *
 * Dates here are plain "YYYY-MM-DD" strings, the day as a person in India
 * would name it. No time zone arithmetic: a planner entry is about a day on
 * a calendar, not an instant.
 */

export type PlannerPeriod = "day" | "week";

/** True for a well-formed, real "YYYY-MM-DD". */
export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** The Monday of the week a date falls in. Weeks here start on Monday. */
export function weekStart(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(key, day === 0 ? -6 : 1 - day);
}

/** The seven days of that week, Monday first. */
export function weekDays(key: string): string[] {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * The date a planner entry is filed under: the day itself for a daily
 * entry, that week's Monday for a weekly one. Normalising on the way in is
 * what lets "the week of the 8th" and "the week of the 10th" be one entry.
 */
export function entryDateFor(period: PlannerPeriod, key: string): string {
  return period === "week" ? weekStart(key) : key;
}

/** The day before and after, for stepping through a planner. */
export function shiftPeriod(
  period: PlannerPeriod,
  key: string,
  direction: 1 | -1
): string {
  return addDays(entryDateFor(period, key), direction * (period === "week" ? 7 : 1));
}

/** "8 Oct 2026", or "6–12 Oct 2026" for a week. */
export function describePeriod(period: PlannerPeriod, key: string): string {
  const fmt = (k: string, withMonth = true, withYear = true) => {
    const [y, m, d] = k.split("-").map(Number);
    const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-GB", {
      month: "short",
      timeZone: "UTC",
    });
    return `${d}${withMonth ? ` ${month}` : ""}${withYear ? ` ${y}` : ""}`;
  };
  if (period === "day") return fmt(key);
  const days = weekDays(key);
  const first = days[0];
  const last = days[6];
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return `${fmt(first, !sameMonth, false)}–${fmt(last)}`;
}

/** Today in India, as "YYYY-MM-DD". */
export function todayIst(now: Date = new Date()): string {
  // +05:30 from UTC. Shifting the instant and reading it as UTC gives the
  // Indian calendar date without pulling in a time zone library.
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * The start of a range reaching `count` periods back from `key` — what a
 * download covers by default: a month of days, or a quarter of weeks.
 */
export function rangeBack(period: PlannerPeriod, key: string, count: number): string {
  let at = entryDateFor(period, key);
  for (let i = 0; i < count; i += 1) at = shiftPeriod(period, at, -1);
  return at;
}
