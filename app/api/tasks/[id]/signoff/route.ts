import { NextRequest } from "next/server";
import { query, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict, forbidden } from "@/lib/http";
import {
  assertProjectAccess,
  assertTaskWritable,
  canManageProject,
} from "@/lib/rbac";
import { signOffSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { fetchTasks } from "@/lib/tasks";
import { canSignOff, isOwnWork, signOffBlockers } from "@/lib/workflow";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/tasks/:id/signoff { note? }
 * The requester or an admin/project lead signs off a Done task once its trail
 * is complete (requested by, approved by, assigned owner). After sign-off the
 * task — and everything on it — is permanently read-only.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const [task] = await fetchTasks("t.id = ?", [taskId]);
    if (!task) throw new ApiError(404, "Task not found");
    const { projectRole } = await assertProjectAccess(user, task.project_id);

    const manager = canManageProject(user, projectRole);
    const trail = { requested_by: task.requested_by, assignee_id: task.assignee_id };
    if (!canSignOff(user, manager, trail)) {
      throw forbidden(
        isOwnWork(user, trail)
          ? "You can't sign off your own work — ask the requester, a project lead or an admin"
          : "Only the person who requested this task or an admin/project lead can sign it off"
      );
    }
    await assertTaskWritable(taskId);
    const blockers = signOffBlockers(
      {
        status: task.status,
        signed_off_at: task.signed_off_at,
        requested_by: task.requested_by,
        request_approved_by: task.request_approved_by,
        assignee_id: task.assignee_id,
      },
      { signerIsManager: manager }
    );
    if (blockers.length) {
      throw conflict(`This task can't be signed off yet: ${blockers.join("; ")}.`);
    }

    const { note } = signOffSchema.parse(await req.json().catch(() => ({})));
    // A lead signing off a task with no recorded approver is recorded as the
    // approver as well (non-managers were blocked above in that case).
    const res = (await query<DbResult>(
      `UPDATE tasks
          SET signed_off_by = ?, signed_off_at = UTC_TIMESTAMP(), signoff_note = ?,
              request_approved_by = COALESCE(request_approved_by, ?),
              request_approved_at = COALESCE(request_approved_at, UTC_TIMESTAMP())
        WHERE id = ? AND signed_off_at IS NULL AND status = 'done'`,
      [user.id, note || null, user.id, taskId]
    )) as unknown as DbResult;
    if (res.affectedRows === 0) {
      throw conflict("This task was changed or signed off by someone else — reload and try again.");
    }

    await logActivity({
      userId: user.id,
      action: "task.signed_off",
      entityType: "task",
      entityId: taskId,
      metadata: { title: task.title, note: note || null },
    });
    const link = `/projects/${task.project_id}`;
    const notified = new Set<number>([user.id]);
    for (const uid of [task.assignee_id, task.requested_by, task.request_approved_by]) {
      if (!uid || notified.has(uid)) continue;
      notified.add(uid);
      await notify(uid, "task_signed_off", `"${task.title}" was signed off by ${user.name}`, link);
    }

    const [updated] = await fetchTasks("t.id = ?", [taskId]);
    return json({ task: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
