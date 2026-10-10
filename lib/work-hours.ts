/**
 * Hours at work, next to hours logged against tasks.
 *
 * Two systems hold half the picture each: the Attendance app knows when
 * someone clocked in and out, PM knows what they logged against which task.
 * Neither alone says whether the day's work is accounted for.
 *
 * Read the gap as a prompt to log time, not as a measure of effort. People
 * think, read, travel and sit in meetings without a task open, and 31% of
 * attendance rows are `absent` — which on this install means "no clock-in
 * recorded", not "did not work". A number presented as judgement that people
 * know to be wrong is how a tool loses their trust, and with it their data.
 *
 * Pure: no database, no clock. Testable on its own.
 */

export type DayStatus =
  | "present"
  | "late"
  | "early_departure"
  | "absent"
  | "leave"
  | "holiday";

export interface AttendanceDayInput {
  employee_id: number;
  work_date: string;
  status: DayStatus;
  total_minutes: number | null;
}

/** Minutes logged against tasks, already grouped by local date. */
export interface LoggedDayInput {
  user_id: number;
  /** Local (IST) date, "YYYY-MM-DD". */
  day: string;
  minutes: number;
}

export interface PersonDay {
  date: string;
  status: DayStatus | null;
  presentMinutes: number;
  loggedMinutes: number;
}

export interface PersonWorkHours {
  userId: number;
  employeeId: number;
  name: string;
  department: string | null;
  days: PersonDay[];
  /** Totals over the range. */
  presentMinutes: number;
  loggedMinutes: number;
  daysPresent: number;
  /**
   * Logged as a share of time at work, 0–1, or null when there is nothing to
   * compare against (no attendance recorded in the range).
   */
  coverage: number | null;
}

export interface PersonRef {
  userId: number;
  employeeId: number;
  name: string;
  department?: string | null;
}

/** Days from `from` to `to` inclusive, as "YYYY-MM-DD". */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** The Monday on or before a date, and its Sunday — the week PM reports on. */
export function weekBounds(isoDate: string): { from: string; to: string } {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  // getUTCDay: 0 = Sunday. Monday-start weeks suit a working week better.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  const from = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { from, to: d.toISOString().slice(0, 10) };
}

/** Days where someone was actually at work — the only ones worth comparing. */
function countsAsAtWork(status: DayStatus | null): boolean {
  return status === "present" || status === "late" || status === "early_departure";
}

/**
 * Merge both halves into one row per person per day.
 *
 * A person with no attendance rows still appears, so someone who logs time
 * without clocking in is visible rather than silently missing.
 */
export function buildWorkHours(
  people: PersonRef[],
  attendance: AttendanceDayInput[],
  logged: LoggedDayInput[],
  from: string,
  to: string
): PersonWorkHours[] {
  const dates = dateRange(from, to);

  const byEmployeeDay = new Map<string, AttendanceDayInput>();
  for (const a of attendance) {
    byEmployeeDay.set(`${a.employee_id}|${String(a.work_date).slice(0, 10)}`, a);
  }
  const byUserDay = new Map<string, number>();
  for (const l of logged) {
    const key = `${l.user_id}|${String(l.day).slice(0, 10)}`;
    byUserDay.set(key, (byUserDay.get(key) ?? 0) + Number(l.minutes || 0));
  }

  return people.map((p) => {
    const days: PersonDay[] = dates.map((date) => {
      const a = byEmployeeDay.get(`${p.employeeId}|${date}`);
      const status = (a?.status ?? null) as DayStatus | null;
      return {
        date,
        status,
        // Minutes are only meaningful on a day someone was at work; an
        // `absent` row carrying a stray total would otherwise inflate a week.
        presentMinutes: countsAsAtWork(status) ? Number(a?.total_minutes ?? 0) : 0,
        loggedMinutes: byUserDay.get(`${p.userId}|${date}`) ?? 0,
      };
    });

    const presentMinutes = days.reduce((n, d) => n + d.presentMinutes, 0);
    const loggedMinutes = days.reduce((n, d) => n + d.loggedMinutes, 0);
    return {
      userId: p.userId,
      employeeId: p.employeeId,
      name: p.name,
      department: p.department ?? null,
      days,
      presentMinutes,
      loggedMinutes,
      daysPresent: days.filter((d) => countsAsAtWork(d.status)).length,
      coverage: presentMinutes > 0 ? loggedMinutes / presentMinutes : null,
    };
  });
}

/**
 * Whose hours someone may see.
 *
 *   admin    → everyone
 *   manager  → themselves and their direct reports (employees.manager_id)
 *   everyone → themselves
 *
 * Managers come from the Attendance app's reporting line, not PM's roles:
 * PM only knows `admin` and `member`, which is not the same question.
 */
export function visibleEmployeeIds(
  viewer: { employeeId: number; isAdmin: boolean },
  directory: { id: number; manager_id: number | null }[]
): number[] {
  if (viewer.isAdmin) return directory.map((e) => e.id);
  const reports = directory
    .filter((e) => e.manager_id === viewer.employeeId)
    .map((e) => e.id);
  return Array.from(new Set([viewer.employeeId, ...reports]));
}

/** "7h 25m" — minutes are how the data arrives; nobody reads in minutes. */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}
