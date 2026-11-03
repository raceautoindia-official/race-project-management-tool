import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET — where a task's time went: the timer and hand-typed totals, by person
 * and by subtask, against the estimate, plus who is on it right now.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const [task] = await query<DbRow[]>(
      `SELECT id, project_id, estimated_hours FROM tasks WHERE id = ? LIMIT 1`,
      [taskId]
    );
    if (!task) throw new ApiError(404, "Task not found");
    await assertProjectAccess(user, Number(task.project_id));

    const [totals] = await query<DbRow[]>(
      `SELECT COALESCE(SUM(minutes), 0) AS total,
              COALESCE(SUM(CASE WHEN source = 'timer' THEN minutes END), 0) AS timer,
              COALESCE(SUM(CASE WHEN source = 'manual' THEN minutes END), 0) AS manual,
              COALESCE(SUM(CASE WHEN source = 'timer'
                AND logged_at >= CONVERT_TZ(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')), '+05:30', '+00:00')
                THEN minutes END), 0) AS today
         FROM task_time_logs WHERE task_id = ?`,
      [taskId]
    );
    const byPerson = await query<DbRow[]>(
      `SELECT l.user_id, u.name, SUM(l.minutes) AS minutes
         FROM task_time_logs l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.task_id = ?
        GROUP BY l.user_id, u.name ORDER BY minutes DESC`,
      [taskId]
    );
    const bySubtask = await query<DbRow[]>(
      `SELECT s.id, s.title, s.status, COALESCE(SUM(l.minutes), 0) AS minutes
         FROM subtasks s LEFT JOIN task_time_logs l ON l.subtask_id = s.id
        WHERE s.task_id = ?
        GROUP BY s.id, s.title, s.status, s.position ORDER BY s.position, s.id`,
      [taskId]
    );
    const running = await query<DbRow[]>(
      `SELECT ws.user_id, u.name, ws.subtask_id, s.title AS subtask_title, ws.started_at
         FROM work_sessions ws
         JOIN users u ON u.id = ws.user_id
         LEFT JOIN subtasks s ON s.id = ws.subtask_id
        WHERE ws.task_id = ? AND ws.ended_at IS NULL`,
      [taskId]
    );

    // Running stretches are not logged yet; count them so far.
    const now = Date.now();
    const liveMinutes = running.reduce(
      (n, r) => n + Math.max(0, Math.floor((now - new Date(String(r.started_at).replace(" ", "T") + "Z").getTime()) / 60_000)),
      0
    );

    return json({
      totalMinutes: Number(totals.total) + liveMinutes,
      timerMinutes: Number(totals.timer) + liveMinutes,
      manualMinutes: Number(totals.manual),
      todayMinutes: Number(totals.today) + liveMinutes,
      estimateMinutes: task.estimated_hours == null ? null : Math.round(Number(task.estimated_hours) * 60),
      byPerson: byPerson.map((r) => ({
        userId: r.user_id == null ? null : Number(r.user_id),
        name: (r.name as string | null) ?? "Former member",
        minutes: Number(r.minutes),
      })),
      bySubtask: bySubtask.map((r) => ({
        id: Number(r.id),
        title: String(r.title),
        status: String(r.status),
        minutes: Number(r.minutes),
      })),
      running: running.map((r) => ({
        userId: Number(r.user_id),
        name: String(r.name),
        subtaskId: r.subtask_id == null ? null : Number(r.subtask_id),
        subtaskTitle: (r.subtask_title as string | null) ?? null,
        startedAt: String(r.started_at),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
