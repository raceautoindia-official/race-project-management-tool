import "server-only";
import { query, DbRow } from "./db";
import { fetchClockRows, fetchEmployeeProfiles } from "./attendance";
import type { ClockRow } from "./attendance-clock";
import { visibleEmployeeIds } from "./work-hours";
import { buildPersonDay, istDayBounds, teamTotals, type PersonDay, type SessionInput, type TeamDayTotals } from "./time-metrics";
import { reconcileTimers } from "./work-timer";

/**
 * Loads one day of clock rows, timer sessions and hand-typed time for the
 * people a viewer may see, and hands them to lib/time-metrics.ts.
 *
 * Who may see whom is the Work hours rule (lib/work-hours.ts): everyone sees
 * themselves, a manager their direct reports in Attendance, an admin everyone.
 */

export interface TimeDayReport {
  date: string;
  people: PersonDay[];
  totals: TeamDayTotals;
  ownOnly: boolean;
  attendanceUnavailable: boolean;
}

const ORDER: Record<PersonDay["state"], number> = { working: 0, idle: 1, clocked_out: 2, not_in: 3 };

function sqlUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Timer sessions of these people that overlap [from, to). */
export async function sessionsBetween(userIds: number[], from: Date, to: Date): Promise<SessionInput[]> {
  if (!userIds.length) return [];
  const rows = await query<DbRow[]>(
    `SELECT ws.user_id, ws.task_id, ws.subtask_id, ws.started_at, ws.ended_at,
            t.title AS task_title, s.title AS subtask_title, p.id AS project_id, p.name AS project_name
       FROM work_sessions ws
       JOIN tasks t ON t.id = ws.task_id
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN subtasks s ON s.id = ws.subtask_id
      WHERE ws.user_id IN (${userIds.map(() => "?").join(",")})
        AND ws.started_at < ? AND (ws.ended_at IS NULL OR ws.ended_at > ?)
      ORDER BY ws.started_at`,
    [...userIds, sqlUtc(to), sqlUtc(from)]
  );
  return rows.map((r) => ({
    user_id: Number(r.user_id),
    task_id: Number(r.task_id),
    subtask_id: r.subtask_id == null ? null : Number(r.subtask_id),
    started_at: String(r.started_at),
    ended_at: r.ended_at == null ? null : String(r.ended_at),
    task_title: String(r.task_title),
    subtask_title: (r.subtask_title as string | null) ?? null,
    project_id: Number(r.project_id),
    project_name: String(r.project_name),
  }));
}

export async function getTimeDay(
  viewer: { id: number; employee_id: number; role: string },
  day: string,
  now: Date = new Date()
): Promise<TimeDayReport> {
  let attendanceUnavailable = false;
  let directory: Awaited<ReturnType<typeof fetchEmployeeProfiles>> = [];
  try {
    directory = await fetchEmployeeProfiles();
  } catch (err) {
    console.error("[time] attendance directory unavailable:", (err as Error).message);
    attendanceUnavailable = true;
  }
  const employeeIds = attendanceUnavailable
    ? [viewer.employee_id]
    : visibleEmployeeIds({ employeeId: viewer.employee_id, isAdmin: viewer.role === "admin" }, directory);

  const users = employeeIds.length
    ? await query<DbRow[]>(
        `SELECT id, employee_id, name, department FROM users
          WHERE is_active = TRUE AND employee_id IN (${employeeIds.map(() => "?").join(",")})
          ORDER BY name`,
        employeeIds
      )
    : [];
  const people = users.map((u) => ({
    userId: Number(u.id),
    employeeId: Number(u.employee_id),
    name: String(u.name),
    department: (u.department as string | null) ?? null,
  }));
  const empty = { date: day, people: [], totals: teamTotals([]), ownOnly: true, attendanceUnavailable };
  if (!people.length) return empty;
  const userIds = people.map((p) => p.userId);

  const { start, end } = istDayBounds(day);
  // Today's numbers should reflect anyone who clocked out a moment ago.
  if (now >= start && now < end) await reconcileTimers({ userIds, now }).catch(() => undefined);

  const [sessions, manual, rows] = await Promise.all([
    sessionsBetween(userIds, start, end),
    query<DbRow[]>(
      `SELECT user_id, SUM(minutes) AS minutes FROM task_time_logs
        WHERE source = 'manual' AND user_id IN (${userIds.map(() => "?").join(",")})
          AND logged_at >= ? AND logged_at < ?
        GROUP BY user_id`,
      [...userIds, sqlUtc(start), sqlUtc(end)]
    ),
    attendanceUnavailable
      ? Promise.resolve([] as ClockRow[])
      : fetchClockRows(people.map((p) => p.employeeId), dayBefore(day)).catch((err) => {
          console.error("[time] attendance rows unavailable:", (err as Error).message);
          attendanceUnavailable = true;
          return [] as ClockRow[];
        }),
  ]);
  const manualOf = new Map(manual.map((r) => [Number(r.user_id), Number(r.minutes ?? 0)]));

  const days = people
    .map((p) =>
      buildPersonDay(
        p,
        day,
        rows.filter((r) => r.employee_id === p.employeeId && r.work_date <= day),
        sessions.filter((s) => s.user_id === p.userId),
        manualOf.get(p.userId) ?? 0,
        now
      )
    )
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));

  return { date: day, people: days, totals: teamTotals(days), ownOnly: people.length <= 1, attendanceUnavailable };
}

/** One open item's timer history for its assignee: My Work › Working on. */
export interface ItemTime {
  /** Timer minutes today (IST) from stretches that have ended. */
  todayMinutes: number;
  /** Timer minutes from stretches that have ended, ever. */
  totalMinutes: number;
  lastStartedAt: string | null;
  lastEndedAt: string | null;
  lastEndReason: string | null;
}

/** "s12" for subtask 12, "t7" for task 7 timed without subtasks. */
export function itemTimeKey(taskId: number, subtaskId: number | null): string {
  return subtaskId ? `s${subtaskId}` : `t${taskId}`;
}

/**
 * Timer totals, today's time and the latest stretch for every task and
 * subtask this person has timed. A running stretch is left out of the
 * minutes (the page counts it live) but is the latest stretch.
 */
export async function myItemTimes(userId: number, now = new Date()): Promise<Record<string, ItemTime>> {
  const totals = await query<DbRow[]>(
    `SELECT task_id, subtask_id, SUM(COALESCE(minutes, 0)) AS total, MAX(id) AS last_id
       FROM work_sessions WHERE user_id = ? GROUP BY task_id, subtask_id`,
    [userId]
  );
  const out: Record<string, ItemTime> = {};
  if (!totals.length) return out;
  const last = await query<DbRow[]>(
    `SELECT task_id, subtask_id, started_at, ended_at, end_reason FROM work_sessions
      WHERE id IN (${totals.map(() => "?").join(",")})`,
    totals.map((r) => Number(r.last_id))
  );
  for (const r of totals) {
    out[itemTimeKey(Number(r.task_id), r.subtask_id == null ? null : Number(r.subtask_id))] = {
      todayMinutes: 0,
      totalMinutes: Number(r.total),
      lastStartedAt: null,
      lastEndedAt: null,
      lastEndReason: null,
    };
  }
  for (const r of last) {
    const t = out[itemTimeKey(Number(r.task_id), r.subtask_id == null ? null : Number(r.subtask_id))];
    if (!t) continue;
    t.lastStartedAt = String(r.started_at);
    t.lastEndedAt = r.ended_at == null ? null : String(r.ended_at);
    t.lastEndReason = (r.end_reason as string | null) ?? null;
  }
  const { start, end } = istDayBounds(istDayOf(now));
  for (const s of await sessionsBetween([userId], start, end)) {
    if (!s.ended_at) continue;
    const t = out[itemTimeKey(s.task_id, s.subtask_id)];
    if (!t) continue;
    const from = Math.max(start.getTime(), Date.parse(s.started_at.replace(" ", "T") + "Z"));
    const to = Math.min(end.getTime(), Date.parse(s.ended_at.replace(" ", "T") + "Z"));
    t.todayMinutes += Math.max(0, (to - from) / 60_000);
  }
  for (const t of Object.values(out)) t.todayMinutes = Math.round(t.todayMinutes);
  return out;
}

function istDayOf(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
