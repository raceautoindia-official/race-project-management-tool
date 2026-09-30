import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict } from "@/lib/http";
import { assertProjectManage, assertTaskWritable } from "@/lib/rbac";
import { logActivity, notify } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/tasks/:id/dependencies/decision — a lead decides a blocker a
 * member raised.
 *   approve → it counts from now on: the task shows as blocked until the
 *             other task is done.
 *   reject  → it is removed, with the reason sent to whoever raised it.
 *
 * Rejecting needs a reason. Someone said they were stuck; "no" on its own
 * leaves them exactly as stuck, and none the wiser.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const [task] = await query<DbRow[]>(
      `SELECT id, project_id, title FROM tasks WHERE id = ? LIMIT 1`,
      [taskId]
    );
    if (!task) throw new ApiError(404, "Task not found");
    await assertProjectManage(user, task.project_id);
    await assertTaskWritable(taskId);

    const body = await req.json().catch(() => ({}));
    const dependsOn = Number(body.dependsOnTaskId);
    const decision = String(body.decision ?? "");
    const note = String(body.note ?? "").trim().slice(0, 500);
    if (!Number.isInteger(dependsOn)) throw new ApiError(400, "Invalid dependsOnTaskId");
    if (decision !== "approve" && decision !== "reject") {
      throw new ApiError(400, "Decision must be approve or reject");
    }
    if (decision === "reject" && !note) {
      throw new ApiError(400, "Say why, so the person who raised it knows where they stand");
    }

    const [row] = await query<DbRow[]>(
      `SELECT d.status, d.requested_by, t.title
         FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_task_id
        WHERE d.task_id = ? AND d.depends_on_task_id = ? LIMIT 1`,
      [taskId, dependsOn]
    );
    if (!row) throw new ApiError(404, "That blocker is no longer there");
    if (row.status !== "pending") throw conflict("This blocker has already been decided");

    if (decision === "approve") {
      await query(
        `UPDATE task_dependencies
            SET status = 'approved', decided_by = ?, decided_at = UTC_TIMESTAMP()
          WHERE task_id = ? AND depends_on_task_id = ?`,
        [user.id, taskId, dependsOn]
      );
    } else {
      await query(
        `DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?`,
        [taskId, dependsOn]
      );
    }

    await logActivity({
      userId: user.id,
      action: decision === "approve" ? "task.blocker_approved" : "task.blocker_rejected",
      entityType: "task",
      entityId: taskId,
      metadata: { dependsOn, note: note || null },
    });

    if (row.requested_by && row.requested_by !== user.id) {
      await notify(
        row.requested_by,
        decision === "approve" ? "blocker_approved" : "blocker_rejected",
        decision === "approve"
          ? `${user.name} agreed: "${task.title}" is blocked by "${row.title}"`
          : `${user.name} did not agree that "${task.title}" is blocked by "${row.title}": ${note}`,
        `/projects/${task.project_id}?task=${taskId}`
      );
    }

    const rows = await query<DbRow[]>(
      `SELECT d.depends_on_task_id AS id, t.title, t.status,
              d.status AS approval, d.reason, d.requested_by,
              u.name AS requester_name
         FROM task_dependencies d
         JOIN tasks t ON t.id = d.depends_on_task_id
         LEFT JOIN users u ON u.id = d.requested_by
        WHERE d.task_id = ?
        ORDER BY d.status ASC, t.title`,
      [taskId]
    );
    return json({
      dependencies: rows.map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        done: d.status === "done",
        approval: d.approval,
        reason: d.reason ?? null,
        requested_by: d.requested_by ?? null,
        requester_name: d.requester_name ?? null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
