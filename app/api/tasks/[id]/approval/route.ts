import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict } from "@/lib/http";
import { assertProjectManage, assertTaskWritable } from "@/lib/rbac";
import { approvalSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/tasks/:id/approval — a manager (admin / project lead / owner)
 * decides a task that is waiting for review.
 *   approve → Done, exactly as PATCH status=done does: outstanding cleared,
 *             approval stamped, completion time recorded, requester asked to
 *             sign off.
 *   reject  → back to In progress with the note; it stays outstanding if it
 *             was overdue, and the owner is told what to change.
 *
 * Before 2026-10-17 this waited for approval_status = 'pending', which nothing
 * ever set, so the route could never succeed. It now acts on the state tasks
 * really wait in: status = 'review'.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const rows = await query<DbRow[]>(
      `SELECT id, project_id, title, assignee_id, requested_by, status
       FROM tasks WHERE id = ? LIMIT 1`,
      [taskId]
    );
    const task = rows[0];
    if (!task) throw new ApiError(404, "Task not found");

    await assertProjectManage(user, task.project_id);
    await assertTaskWritable(taskId);

    if (task.status !== "review") {
      throw conflict("This task is not waiting for review");
    }

    const { decision, note } = approvalSchema.parse(
      await req.json().catch(() => ({}))
    );

    // Guarded on the state just read, so two managers deciding at once
    // cannot both win.
    const res = (await query<DbResult>(
      decision === "approve"
        ? `UPDATE tasks
              SET status = 'done', outstanding = 0, approval_status = 'approved',
                  approved_by = ?, approved_at = UTC_TIMESTAMP(), completed_at = UTC_TIMESTAMP(),
                  request_approved_by = COALESCE(request_approved_by, ?),
                  request_approved_at = COALESCE(request_approved_at, UTC_TIMESTAMP())
            WHERE id = ? AND status = 'review' AND signed_off_at IS NULL`
        : `UPDATE tasks
              SET status = 'in_progress', approval_status = 'none'
            WHERE id = ? AND status = 'review' AND signed_off_at IS NULL`,
      decision === "approve" ? [user.id, user.id, taskId] : [taskId]
    )) as unknown as DbResult;
    if (res.affectedRows === 0) throw conflict("Someone else decided this task first");

    await logActivity({
      userId: user.id,
      action: decision === "approve" ? "task.approved" : "task.rejected",
      entityType: "task",
      entityId: taskId,
      metadata: { title: task.title, note: note ?? null },
    });

    const link = `/projects/${task.project_id}?task=${taskId}`;
    if (task.assignee_id && task.assignee_id !== user.id) {
      await notify(
        task.assignee_id,
        decision === "approve" ? "task_approved" : "task_sent_back",
        decision === "approve"
          ? `Your task "${task.title}" was approved and marked done`
          : `"${task.title}" was sent back${note ? `: ${note}` : ""}`,
        link
      );
    }
    if (decision === "approve" && task.requested_by && task.requested_by !== user.id) {
      await notify(
        task.requested_by,
        "signoff_requested",
        `"${task.title}" is done — please review and sign it off`,
        link
      );
    }

    return json({ ok: true, decision });
  } catch (err) {
    return errorResponse(err);
  }
}
