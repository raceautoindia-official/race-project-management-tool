import "server-only";
import { query, DbRow } from "@/lib/db";
import {
  formatMinutes,
  type DailySummary,
  type SummaryTask,
} from "@/lib/planner-summary-shape";

export { formatMinutes, summaryLine } from "@/lib/planner-summary-shape";
export type { DailySummary, SummaryTask } from "@/lib/planner-summary-shape";

/**
 * What someone actually did on a day, worked out rather than typed.
 *
 * Everything here is already recorded as a side effect of using the app —
 * time logged, tasks finished, meetings attended — so the summary fills
 * itself in and is right by the time anyone looks at it. The person's own
 * note sits alongside it, for what the records cannot say.
 *
 * Times are grouped by the Indian calendar day, like the rest of the app:
 * work logged at 11pm belongs to that day, not to the UTC one after it.
 */

const IST = "+05:30";

function mapTask(r: DbRow): SummaryTask {
  return {
    id: r.id as number,
    title: r.title as string,
    project_name: (r.project_name as string) ?? null,
    minutes: Number(r.minutes ?? 0),
    is_additional: Boolean(r.is_additional),
  };
}

/** The day's work for one person, as the app recorded it. */
export async function dailySummary(
  userId: number,
  date: string
): Promise<DailySummary> {
  const worked = await query<DbRow[]>(
    `SELECT t.id, t.title, t.is_additional, p.name AS project_name,
            SUM(l.minutes) AS minutes
       FROM task_time_logs l
       JOIN tasks t ON t.id = l.task_id
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE l.user_id = ? AND DATE(CONVERT_TZ(l.logged_at, '+00:00', ?)) = ?
      GROUP BY t.id, t.title, t.is_additional, p.name
      ORDER BY minutes DESC`,
    [userId, IST, date]
  );

  const completed = await query<DbRow[]>(
    `SELECT t.id, t.title, t.is_additional, p.name AS project_name, 0 AS minutes
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? AND t.completed_at IS NOT NULL
        AND DATE(CONVERT_TZ(t.completed_at, '+00:00', ?)) = ?
      ORDER BY t.title`,
    [userId, IST, date]
  );

  // Follow-up work raised after something was already finished: the app's own
  // word for it is "additional", and it is the part of a day nobody planned.
  const extra = await query<DbRow[]>(
    `SELECT t.id, t.title, t.is_additional, p.name AS project_name, 0 AS minutes
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? AND t.is_additional = 1
        AND DATE(CONVERT_TZ(t.created_at, '+00:00', ?)) = ?
      ORDER BY t.title`,
    [userId, IST, date]
  );

  const meetings = await query<DbRow[]>(
    `SELECT m.id, m.title,
            DATE_FORMAT(CONVERT_TZ(m.start_time, '+00:00', ?), '%H:%i') AS at
       FROM meetings m
      WHERE (m.created_by = ?
             OR m.id IN (SELECT meeting_id FROM meeting_attendees WHERE user_id = ?))
        AND DATE(CONVERT_TZ(m.start_time, '+00:00', ?)) = ?
      ORDER BY m.start_time`,
    [IST, userId, userId, IST, date]
  );

  const [{ comments }] = await query<DbRow[]>(
    `SELECT COUNT(*) AS comments FROM activity_log
      WHERE user_id = ? AND action = 'task.commented'
        AND DATE(CONVERT_TZ(created_at, '+00:00', ?)) = ?`,
    [userId, IST, date]
  );

  const workedTasks = worked.map(mapTask);
  const totalMinutes = workedTasks.reduce((sum, t) => sum + t.minutes, 0);
  const completedTasks = completed.map(mapTask);
  const extraTasks = extra.map(mapTask);

  return {
    worked: workedTasks,
    completed: completedTasks,
    extra: extraTasks,
    meetings: meetings.map((m) => ({
      id: m.id as number,
      title: m.title as string,
      at: m.at as string,
    })),
    comments: Number(comments),
    totalMinutes,
    empty:
      workedTasks.length === 0 &&
      completedTasks.length === 0 &&
      extraTasks.length === 0 &&
      meetings.length === 0 &&
      Number(comments) === 0,
  };
}

/**
 * The one-line version for several people at once — what a lead reads down
 * the page. Three grouped queries rather than one summary each, so a team
 * of twenty is not forty round trips.
 */
export async function dailySummaryLines(
  userIds: number[],
  date: string
): Promise<Map<number, string>> {
  const lines = new Map<number, string>();
  if (!userIds.length) return lines;
  const list = userIds.map(() => "?").join(",");

  const worked = await query<DbRow[]>(
    `SELECT l.user_id, COUNT(DISTINCT l.task_id) AS tasks, SUM(l.minutes) AS minutes
       FROM task_time_logs l
      WHERE l.user_id IN (${list})
        AND DATE(CONVERT_TZ(l.logged_at, '+00:00', ?)) = ?
      GROUP BY l.user_id`,
    [...userIds, IST, date]
  );
  const done = await query<DbRow[]>(
    `SELECT assignee_id AS user_id, COUNT(*) AS n FROM tasks
      WHERE assignee_id IN (${list}) AND completed_at IS NOT NULL
        AND DATE(CONVERT_TZ(completed_at, '+00:00', ?)) = ?
      GROUP BY assignee_id`,
    [...userIds, IST, date]
  );
  const extra = await query<DbRow[]>(
    `SELECT assignee_id AS user_id, COUNT(*) AS n FROM tasks
      WHERE assignee_id IN (${list}) AND is_additional = 1
        AND DATE(CONVERT_TZ(created_at, '+00:00', ?)) = ?
      GROUP BY assignee_id`,
    [...userIds, IST, date]
  );

  const by = (rows: DbRow[]) =>
    new Map(rows.map((r) => [r.user_id as number, r]));
  const w = by(worked);
  const d = by(done);
  const e = by(extra);

  for (const id of userIds) {
    const parts = [
      w.get(id)
        ? `${w.get(id)!.tasks} task${Number(w.get(id)!.tasks) === 1 ? "" : "s"} (${formatMinutes(
            Number(w.get(id)!.minutes)
          )})`
        : null,
      d.get(id) ? `${d.get(id)!.n} finished` : null,
      e.get(id) ? `${e.get(id)!.n} extra` : null,
    ].filter(Boolean);
    if (parts.length) lines.set(id, parts.join(" · "));
  }
  return lines;
}
