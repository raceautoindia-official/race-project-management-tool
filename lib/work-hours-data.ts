import "server-only";
import { query, DbRow } from "./db";
import { fetchAttendanceDays, fetchEmployeeProfiles } from "./attendance";
import {
  buildWorkHours,
  visibleEmployeeIds,
  type LoggedDayInput,
  type PersonRef,
  type PersonWorkHours,
} from "./work-hours";

/**
 * Pulls the two halves — attendance days and PM time logs — and hands them to
 * buildWorkHours. Kept apart from that logic so the merging stays testable
 * without either database.
 */

/** Offsets, not zone names: CONVERT_TZ with names needs the tz tables loaded. */
const IST = "+05:30";

/**
 * Minutes logged per person per **IST** day.
 *
 * logged_at is stored in UTC. Grouping by the UTC date would move anything
 * logged after 18:30 IST onto the next day, so a normal evening's work would
 * land on a day the person may not even have been at work.
 */
export async function fetchLoggedMinutes(
  userIds: number[],
  fromDate: string,
  toDate: string
): Promise<LoggedDayInput[]> {
  if (!userIds.length) return [];
  const holes = userIds.map(() => "?").join(",");
  const rows = await query<DbRow[]>(
    `SELECT user_id,
            DATE(CONVERT_TZ(logged_at, '+00:00', ?)) AS day,
            SUM(minutes) AS minutes
       FROM task_time_logs
      WHERE user_id IN (${holes})
        AND logged_at >= CONVERT_TZ(?, ?, '+00:00')
        AND logged_at <  CONVERT_TZ(DATE_ADD(?, INTERVAL 1 DAY), ?, '+00:00')
      GROUP BY user_id, day`,
    [IST, ...userIds, `${fromDate} 00:00:00`, IST, toDate, IST]
  );
  return rows.map((r) => ({
    user_id: Number(r.user_id),
    day: String(r.day).slice(0, 10),
    minutes: Number(r.minutes ?? 0),
  }));
}

export interface WorkHoursReport {
  people: PersonWorkHours[];
  /** True when the viewer is only seeing themselves. */
  ownOnly: boolean;
  /**
   * True when the Attendance database could not be read. The page still
   * shows what PM knows — a reporting page must not go down because the
   * other system is unreachable, and half the picture beats none.
   */
  attendanceUnavailable: boolean;
}

/**
 * The report for one viewer over one date range, already scoped to the people
 * they may see (themselves, their direct reports, or everyone for an admin).
 */
export async function getWorkHours(
  viewer: { id: number; employee_id: number; role: string },
  fromDate: string,
  toDate: string
): Promise<WorkHoursReport> {
  const isAdmin = viewer.role === "admin";

  let attendanceUnavailable = false;
  let directory: Awaited<ReturnType<typeof fetchEmployeeProfiles>> = [];
  try {
    directory = await fetchEmployeeProfiles();
  } catch (err) {
    console.error("[work-hours] attendance directory unavailable:", (err as Error).message);
    attendanceUnavailable = true;
  }

  // Without the directory there is no reporting line to widen the view, so
  // everyone falls back to their own row.
  const employeeIds = attendanceUnavailable
    ? [viewer.employee_id]
    : visibleEmployeeIds({ employeeId: viewer.employee_id, isAdmin }, directory);

  // Only people who exist on both sides can be reported on: PM mirrors an
  // employee on their first sign-in, so anyone who has never used PM has no
  // tasks to compare against and is left out rather than shown as a zero.
  const pmUsers = await query<DbRow[]>(
    `SELECT id, employee_id, name FROM users
      WHERE employee_id IN (${employeeIds.map(() => "?").join(",")})`,
    employeeIds
  );
  if (!pmUsers.length) return { people: [], ownOnly: true, attendanceUnavailable };

  const byEmployee = new Map(directory.map((e) => [e.id, e]));
  const people: PersonRef[] = pmUsers.map((u) => ({
    userId: Number(u.id),
    employeeId: Number(u.employee_id),
    name: String(u.name),
    department: byEmployee.get(Number(u.employee_id))?.department ?? null,
  }));

  const [attendance, logged] = await Promise.all([
    attendanceUnavailable
      ? Promise.resolve([])
      : fetchAttendanceDays(people.map((p) => p.employeeId), fromDate, toDate).catch((err) => {
          console.error("[work-hours] attendance days unavailable:", (err as Error).message);
          attendanceUnavailable = true;
          return [];
        }),
    fetchLoggedMinutes(people.map((p) => p.userId), fromDate, toDate),
  ]);

  return {
    people: buildWorkHours(people, attendance, logged, fromDate, toDate).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
    ownOnly: people.length <= 1,
    attendanceUnavailable,
  };
}
