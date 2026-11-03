import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, badRequest } from "@/lib/http";
import { istDayBounds } from "@/lib/time-metrics";
import { parseUtc, toSqlUtc } from "@/lib/attendance-clock";
import { clockStateOf, istDay, pauseWork, reconcileTimers, runningTimerOf, startWork } from "@/lib/work-timer";

export const dynamic = "force-dynamic";

/**
 * The signed-in person's timer and Attendance clock, for the timer chip.
 * `resume` is the last thing they worked on today, when nothing is running
 * and it is still open for work — what "Resume" picks up after a clock-out.
 */
async function state(userId: number, employeeId: number) {
  const now = new Date();
  const recon = await reconcileTimers({ userIds: [userId], now }).catch(() => null);
  const [clock, running] = await Promise.all([clockStateOf(employeeId, now), runningTimerOf(userId)]);
  const { start, end } = istDayBounds(istDay(now));
  const sessions = await query<DbRow[]>(
    `SELECT started_at, ended_at FROM work_sessions
      WHERE user_id = ? AND started_at < ? AND (ended_at IS NULL OR ended_at > ?)`,
    [userId, toSqlUtc(end), toSqlUtc(start)]
  );
  const trackedMinutes = Math.round(
    sessions.reduce((n, s) => {
      const a = parseUtc(String(s.started_at));
      const b = s.ended_at ? parseUtc(String(s.ended_at)) : now;
      const from = a > start ? a : start;
      return n + Math.max(0, (b.getTime() - from.getTime()) / 60_000);
    }, 0)
  );

  let resume = null;
  if (!running) {
    const [last] = await query<DbRow[]>(
      `SELECT ws.task_id, ws.subtask_id, ws.end_reason, ws.ended_at, t.title AS task_title, s.title AS subtask_title,
              t.project_id
         FROM work_sessions ws
         JOIN tasks t ON t.id = ws.task_id AND t.status IN ('todo','in_progress') AND t.signed_off_at IS NULL
         LEFT JOIN subtasks s ON s.id = ws.subtask_id
        WHERE ws.user_id = ? AND ws.ended_at >= ?
          AND (ws.subtask_id IS NULL OR s.status IN ('todo','in_progress'))
        ORDER BY ws.ended_at DESC LIMIT 1`,
      [userId, toSqlUtc(start)]
    );
    if (last) {
      resume = {
        taskId: Number(last.task_id),
        subtaskId: last.subtask_id == null ? null : Number(last.subtask_id),
        projectId: Number(last.project_id),
        taskTitle: String(last.task_title),
        subtaskTitle: (last.subtask_title as string | null) ?? null,
        endReason: String(last.end_reason),
        endedAt: String(last.ended_at),
      };
    }
  }

  return {
    now: now.toISOString(),
    clock,
    attendanceUnavailable: clock === null || Boolean(recon?.attendanceUnavailable),
    running,
    resume,
    trackedMinutes,
  };
}

async function employeeIdOf(userId: number): Promise<number> {
  const [row] = await query<DbRow[]>(`SELECT employee_id FROM users WHERE id = ?`, [userId]);
  return Number(row?.employee_id ?? 0);
}

/** GET — my timer and clock. */
export async function GET() {
  try {
    const user = await requireUser();
    return json(await state(user.id, await employeeIdOf(user.id)));
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST { action: "start", taskId, subtaskId? } — start or resume work (you
 * must be clocked in on Attendance). Starting stops any other timer.
 * POST { action: "pause" } — stop my timer.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    if (body.action === "start") {
      // A subtask is enough on its own: its task is looked up.
      const subtaskId = body.subtaskId == null ? null : Number(body.subtaskId);
      const taskId = body.taskId == null && subtaskId ? 0 : Number(body.taskId);
      if (!Number.isInteger(taskId) || (subtaskId !== null && !Number.isInteger(subtaskId)) || (!taskId && !subtaskId)) {
        throw badRequest("Say which task or subtask to work on");
      }
      await startWork(user, { taskId, subtaskId });
    } else if (body.action === "pause") {
      await pauseWork(user);
    } else {
      throw badRequest("Unknown action");
    }
    return json(await state(user.id, await employeeIdOf(user.id)));
  } catch (err) {
    return errorResponse(err);
  }
}
