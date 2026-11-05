/**
 * lib/recurrence.ts — when a recurring rule falls due. Pure: dates in and
 * out, as "YYYY-MM-DD" India dates; whether a day is worked comes from the
 * caller (lib/workdays.ts reads WorkLens).
 *
 *   daily    every working day of the copy's owner. A holiday or day off
 *            is skipped.
 *   weekly   on the chosen weekdays, every N weeks (weeks run Monday to
 *            Sunday, counted from the week the rule starts).
 *   monthly  on day N of the month, or the last day (0), every N months.
 *            A month without day N uses its last day (31 → 30 Apr).
 *
 * A weekly or monthly date that lands on a holiday or day off moves to the
 * next working day; a daily one is simply skipped (the next day has one).
 */

export type Frequency = "daily" | "weekly" | "monthly";
export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export const WEEKDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface Schedule {
  frequency: Frequency;
  /** Every N weeks / months; ignored for daily. */
  interval: number;
  /** Weekly: the days it falls on. */
  weekdays: Weekday[];
  /** Monthly: 1–31, or 0 for the last day. */
  monthDay: number | null;
  startDate: string;
  endDate: string | null;
}

/** Is this India date worked (by the copy's owner)? */
export type IsWorkingDay = (date: string) => boolean;

const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return fromUtc(toUtc(date) + n * DAY_MS);
}

export function weekdayOf(date: string): Weekday {
  // getUTCDay: 0 = Sunday.
  return WEEKDAYS[(new Date(toUtc(date)).getUTCDay() + 6) % 7];
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** The Monday of the week a date is in. */
function mondayOf(date: string): string {
  return addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

/** Whether a date is one the schedule names (before any holiday move). */
export function fallsOn(s: Schedule, date: string): boolean {
  if (date < s.startDate || (s.endDate && date > s.endDate)) return false;
  const every = Math.max(1, s.interval || 1);
  if (s.frequency === "daily") return true;
  if (s.frequency === "weekly") {
    if (!s.weekdays.includes(weekdayOf(date))) return false;
    const weeks = Math.round((toUtc(mondayOf(date)) - toUtc(mondayOf(s.startDate))) / (7 * DAY_MS));
    return weeks % every === 0;
  }
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7) - 1;
  const months = (y - +s.startDate.slice(0, 4)) * 12 + (m - (+s.startDate.slice(5, 7) - 1));
  if (months % every !== 0) return false;
  const last = daysInMonth(y, m);
  const want = !s.monthDay ? last : Math.min(s.monthDay, last);
  return +date.slice(8, 10) === want;
}

/** The dates the schedule names in [from, to], oldest first. */
export function scheduledDates(s: Schedule, from: string, to: string): string[] {
  const out: string[] = [];
  const start = from < s.startDate ? s.startDate : from;
  const end = s.endDate && s.endDate < to ? s.endDate : to;
  for (let d = start; d <= end; d = addDays(d, 1)) if (fallsOn(s, d)) out.push(d);
  return out;
}

export interface Occurrence {
  /** The date the schedule names. */
  date: string;
  /** The date the copy is made for: the same, or the next working day. */
  on: string | null;
  /** Why it isn't on its own date (or isn't made at all). */
  reason: "holiday_or_day_off" | null;
}

/** Where one scheduled date lands once holidays and days off are allowed for. */
export function place(s: Schedule, date: string, isWorkingDay: IsWorkingDay): Occurrence {
  if (isWorkingDay(date)) return { date, on: date, reason: null };
  if (s.frequency === "daily") return { date, on: null, reason: "holiday_or_day_off" };
  // Weekly / monthly: the next working day, within a fortnight, and never
  // past the next scheduled date (that one will have its own copy).
  for (let i = 1; i <= 14; i++) {
    const d = addDays(date, i);
    if (s.endDate && d > s.endDate) break;
    if (fallsOn(s, d)) break;
    if (isWorkingDay(d)) return { date, on: d, reason: "holiday_or_day_off" };
  }
  return { date, on: null, reason: "holiday_or_day_off" };
}

/** The next `count` copy dates on or after `from`. */
export function upcoming(s: Schedule, from: string, count: number, isWorkingDay: IsWorkingDay = () => true): string[] {
  const out: string[] = [];
  let d = from < s.startDate ? s.startDate : from;
  // A daily rule with every day off would loop forever; two years is plenty.
  for (let i = 0; i < 730 && out.length < count; i++, d = addDays(d, 1)) {
    if (s.endDate && d > s.endDate) break;
    if (!fallsOn(s, d)) continue;
    const p = place(s, d, isWorkingDay);
    if (p.on && !out.includes(p.on)) out.push(p.on);
  }
  return out.sort();
}

const DAY_NAMES: Record<Weekday, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** "Every working day", "Every Mon & Thu", "Every 2 months on the last day". */
export function describeSchedule(s: Pick<Schedule, "frequency" | "interval" | "weekdays" | "monthDay">): string {
  const every = Math.max(1, s.interval || 1);
  if (s.frequency === "daily") return "Every working day";
  if (s.frequency === "weekly") {
    const days = WEEKDAYS.filter((d) => s.weekdays.includes(d));
    const list =
      days.length === 1
        ? DAY_NAMES[days[0]]
        : days.length === 5 && !days.includes("Sat") && !days.includes("Sun")
          ? "weekday (Mon–Fri)"
          : days.slice(0, -1).join(", ") + " & " + days[days.length - 1];
    return every === 1 ? `Every ${list}` : `Every ${every} weeks on ${days.length === 1 ? DAY_NAMES[days[0]] : list}`;
  }
  const day = !s.monthDay ? "the last day" : `the ${ordinal(s.monthDay)}`;
  return every === 1 ? `Monthly on ${day}` : `Every ${every} months on ${day}`;
}

export function parseWeekdays(v: string | null | undefined): Weekday[] {
  return String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x): x is Weekday => (WEEKDAYS as string[]).includes(x));
}
