import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectManage } from "@/lib/rbac";
import { approvalSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/tasks/:id/approval  — admin/project-lead signs off (or rejects) a
 * late-completed "outstanding" task (#6).
 *   approve → approval_status=approved, outstanding cleared, task closed (done)
 *   reject  → approval_status=rejected, task reopened (in_progress), stays
 *             outstanding; the assignee is notified to redo it.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const rows = await query<DbRow[]>(
      `SELECT id, project_id, title, assignee_id, approval_status
       FROM tasks WHERE id = ? LIMIT 1`,
      [taskId]
    );
    const task = rows[0];
    if (!task) throw new ApiError(404, "Task not found");

    // Only an admin or the project lead may decide.
    await assertProjectManage(user, task.project_id);

    if (task.approval_status !== "pending") {
      throw new ApiError(409, "This task is not awaiting approval");
    }

    const { decision, note } = approvalSchema.parse(
      await req.json().catch(() => ({}))
    );

    if (decision === "approve") {
      await query(
        `UPDATE tasks
           SET approval_status = 'approved', outstanding = 0, status = 'done',
               approved_by = ?, approved_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [user.id, taskId]
      );
    } else {
      await query(
        `UPDATE tasks
           SET approval_status = 'rejected', outstanding = 1,
               status = 'in_progress', approved_by = ?, approved_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [user.id, taskId]
      );
    }

    await logActivity({
      userId: user.id,
      action: decision === "approve" ? "task.approved" : "task.rejected",
      entityType: "task",
      entityId: taskId,
      metadata: { title: task.title, note: note ?? null },
    });

    if (task.assignee_id && task.assignee_id !== user.id) {
      await notify(
        task.assignee_id,
        decision === "approve" ? "task_approved" : "task_rejected",
        decision === "approve"
          ? `Your completion of "${task.title}" was approved`
          : `"${task.title}" was sent back${note ? `: ${note}` : ""}`,
        `/projects/${task.project_id}`
      );
    }

    return json({ ok: true, decision });
  } catch (err) {
    return errorResponse(err);
  }
}
