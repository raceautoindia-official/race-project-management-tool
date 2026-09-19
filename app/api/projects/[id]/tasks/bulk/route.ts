import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict } from "@/lib/http";
import {
  assertNotReferencedBySignedOff,
  assertProjectManage,
  assertProjectWritable,
} from "@/lib/rbac";
import { bulkTaskSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** POST /api/projects/:id/tasks/bulk — apply an action to many tasks (admin/lead). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    assertProjectWritable(await assertProjectManage(user, projectId));

    const data = bulkTaskSchema.parse(await req.json().catch(() => ({})));

    // Only operate on tasks that actually belong to this project.
    const ph = data.taskIds.map(() => "?").join(",");
    const owned = await query<DbRow[]>(
      `SELECT id, task_type, signed_off_at FROM tasks WHERE project_id = ? AND id IN (${ph})`,
      [projectId, ...data.taskIds]
    );
    const ids = owned.map((r) => r.id as number);
    if (ids.length === 0) throw new ApiError(400, "No matching tasks in this project");
    // Signed-off tasks are read-only — refuse rather than silently skip them.
    const locked = owned.filter((r) => r.signed_off_at).length;
    if (locked > 0) {
      throw conflict(
        `${locked} selected task${locked === 1 ? " is" : "s are"} signed off and read-only — deselect ${locked === 1 ? "it" : "them"} first`
      );
    }
    if (
      data.action === "assignee" &&
      data.assigneeId == null &&
      owned.some((r) => r.task_type !== "general")
    ) {
      throw new ApiError(400, "Correction and feature tasks must keep an assigned owner");
    }
    const idPh = ids.map(() => "?").join(",");

    const affected = ids.length;
    if (data.action === "delete") {
      await assertNotReferencedBySignedOff(ids);
      await query(`DELETE FROM tasks WHERE id IN (${idPh})`, ids);
    } else if (data.action === "status") {
      if (!data.status) throw new ApiError(400, "status is required");
      if (data.status === "done") {
        const newlyDone = await query<DbRow[]>(
          `SELECT id, title, assignee_id, requested_by FROM tasks
            WHERE id IN (${idPh}) AND status <> 'done'`,
          ids
        );
        await query(
          `UPDATE tasks SET status='done', outstanding=0, approval_status='approved',
                 approved_by=?, approved_at=UTC_TIMESTAMP(), completed_at=UTC_TIMESTAMP(),
                 request_approved_at=IF(request_approved_by IS NULL, UTC_TIMESTAMP(), request_approved_at),
                 request_approved_by=COALESCE(request_approved_by, approved_by)
             WHERE id IN (${idPh}) AND status <> 'done'`,
          [user.id, ...ids]
        );
        const link = `/projects/${projectId}`;
        for (const t of newlyDone) {
          if (t.assignee_id && t.assignee_id !== user.id) {
            await notify(t.assignee_id, "task_approved", `Your task "${t.title}" was approved and marked done`, link);
          }
          if (t.requested_by && t.requested_by !== user.id) {
            await notify(t.requested_by, "signoff_requested", `"${t.title}" is done — please verify and sign off`, link);
          }
        }
      } else {
        await query(
          `UPDATE tasks
              -- assignments run left to right: check the old status first
              SET approval_status=IF(status='done', 'none', approval_status),
                  status=?, completed_at=NULL
            WHERE id IN (${idPh})`,
          [data.status, ...ids]
        );
      }
    } else if (data.action === "priority") {
      if (!data.priority) throw new ApiError(400, "priority is required");
      await query(`UPDATE tasks SET priority=? WHERE id IN (${idPh})`, [
        data.priority,
        ...ids,
      ]);
    } else if (data.action === "assignee") {
      if (data.assigneeId != null) {
        const m = await query<DbRow[]>(
          `SELECT id FROM project_members WHERE project_id=? AND user_id=? LIMIT 1`,
          [projectId, data.assigneeId]
        );
        if (!m.length) throw new ApiError(400, "Assignee must be a project member");
      }
      await query(`UPDATE tasks SET assignee_id=? WHERE id IN (${idPh})`, [
        data.assigneeId ?? null,
        ...ids,
      ]);
    }

    await logActivity({
      userId: user.id,
      action: "tasks.bulk",
      entityType: "project",
      entityId: projectId,
      metadata: { action: data.action, count: affected },
    });

    return json({ ok: true, affected });
  } catch (err) {
    return errorResponse(err);
  }
}
