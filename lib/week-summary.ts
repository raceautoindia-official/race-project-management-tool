import "server-only";
import { query, DbRow } from "@/lib/db";
import { weekDays } from "@/lib/planner";
import type { UpcomingTask, WeekSummary } from "@/lib/planner-summary-shape";

export type { UpcomingTask, WeekSummary } from "@/lib/planner-summary-shape";
export { weekLine, upcomingLine } from "@/lib/planner-summary-shape";

const IST = "+05:30";

/**
 * The week, from the tasks already on the board and the work already logged.
 *
 * The plan half is a proposal, not a decision: these are the tasks due that
 * week, so the person writing their plan starts from what is actually on
 * them rather than from an empty box. The summary half fills in as the week
 * goes, the same way the daily one does.
 */
export async function weekSummary(
  userId: number,
  weekStart: string
): Promise<WeekSummary> {
  const days = weekDays(weekStart);
  const from = days[0];
  const to = days[6];

  // Due this week, or overdue and still open — both are this week's problem.
  const upcoming = await query<DbRow[]>(
    `SELECT t.id, t.title, t.status, t.priority, t.estimated_hours,
            DATE_FORMAT(t.due_date, '%Y-%m-%d') AS due_date,
            p.name AS project_name,
            (t.due_date < ?) AS overdue
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ?
        AND t.status <> 'done'
        AND t.signed_off_at IS NULL
        AND t.due_date IS NOT NULL
        AND t.due_date <= ?
        AND p.approval_status = 'approved'
        AND p.status <> 'archived'
      ORDER BY t.due_date, FIELD(t.priority, 'urgent', 'high', 'medium', 'low')`,
    [from, userId, to]
  );

  const completed = await query<DbRow[]>(
    `SELECT t.id, t.title, p.name AS project_name,
            DATE_FORMAT(CONVERT_TZ(t.completed_at, '+00:00', ?), '%Y-%m-%d') AS completed_on
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? AND t.completed_at IS NOT NULL
        AND DATE(CONVERT_TZ(t.completed_at, '+00:00', ?)) BETWEEN ? AND ?
      ORDER BY t.completed_at`,
    [IST, userId, IST, from, to]
  );

  const extra = await query<DbRow[]>(
    `SELECT t.id, t.title, p.name AS project_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? AND t.is_additional = 1
        AND DATE(CONVERT_TZ(t.created_at, '+00:00', ?)) BETWEEN ? AND ?
      ORDER BY t.created_at`,
    [userId, IST, from, to]
  );

  const [logged] = await query<DbRow[]>(
    `SELECT COALESCE(SUM(minutes), 0) AS minutes,
            COUNT(DISTINCT DATE(CONVERT_TZ(logged_at, '+00:00', ?))) AS days
       FROM task_time_logs
      WHERE user_id = ?
        AND DATE(CONVERT_TZ(logged_at, '+00:00', ?)) BETWEEN ? AND ?`,
    [IST, userId, IST, from, to]
  );

  const [meetings] = await query<DbRow[]>(
    `SELECT COUNT(*) AS n FROM meetings m
      WHERE (m.created_by = ?
             OR m.id IN (SELECT meeting_id FROM meeting_attendees WHERE user_id = ?))
        AND DATE(CONVERT_TZ(m.start_time, '+00:00', ?)) BETWEEN ? AND ?`,
    [userId, userId, IST, from, to]
  );

  const totalMinutes = Number(logged.minutes);
  const daysWorked = Number(logged.days);
  const meetingCount = Number(meetings.n);

  return {
    upcoming: upcoming.map(
      (t): UpcomingTask => ({
        id: t.id as number,
        title: t.title as string,
        project_name: (t.project_name as string) ?? null,
        due_date: (t.due_date as string) ?? null,
        status: t.status as string,
        priority: t.priority as string,
        estimated_hours: t.estimated_hours == null ? null : Number(t.estimated_hours),
        overdue: Boolean(Number(t.overdue)),
      })
    ),
    completed: completed.map((t) => ({
      id: t.id as number,
      title: t.title as string,
      project_name: (t.project_name as string) ?? null,
      completed_on: t.completed_on as string,
    })),
    extra: extra.map((t) => ({
      id: t.id as number,
      title: t.title as string,
      project_name: (t.project_name as string) ?? null,
    })),
    totalMinutes,
    meetings: meetingCount,
    daysWorked,
    empty:
      upcoming.length === 0 &&
      completed.length === 0 &&
      extra.length === 0 &&
      totalMinutes === 0 &&
      meetingCount === 0,
  };
}

/** The upcoming tasks as a plan someone can paste into their own words. */
export function upcomingAsPlan(upcoming: UpcomingTask[]): string {
  return upcoming.map((t) => t.title).join("\n");
}
