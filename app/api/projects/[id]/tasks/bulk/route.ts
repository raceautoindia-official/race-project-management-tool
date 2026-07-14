import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectManage } from "@/lib/rbac";
import { bulkTaskSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** POST /api/projects/:id/tasks/bulk — apply an action to many tasks (admin/lead). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectManage(user, projectId);

    const data = bulkTaskSchema.parse(await req.json().catch(() => ({})));

    // Only operate on tasks that actually belong to this project.
    const ph = data.taskIds.map(() => "?").join(",");
    const owned = await query<DbRow[]>(
      `SELECT id FROM tasks WHERE project_id = ? AND id IN (${ph})`,
      [projectId, ...data.taskIds]
    );
    const ids = owned.map((r) => r.id as number);
    if (ids.length === 0) throw new ApiError(400, "No matching tasks in this project");
    const idPh = ids.map(() => "?").join(",");

    let affected = ids.length;
    if (data.action === "delete") {
      await query(`DELETE FROM tasks WHERE id IN (${idPh})`, ids);
    } else if (data.action === "status") {
      if (!data.status) throw new ApiError(400, "status is required");
      if (data.status === "done") {
        await query(
          `UPDATE tasks SET status='done', outstanding=0, approval_status='approved',
                 approved_by=?, approved_at=UTC_TIMESTAMP(), completed_at=UTC_TIMESTAMP()
             WHERE id IN (${idPh})`,
          [user.id, ...ids]
        );
      } else {
        await query(
          `UPDATE tasks SET status=?, completed_at=NULL WHERE id IN (${idPh})`,
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
