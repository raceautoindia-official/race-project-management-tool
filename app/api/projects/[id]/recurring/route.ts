import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess, assertProjectManage } from "@/lib/rbac";
import { createRecurringTaskSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

/** GET — recurring task definitions for a project (any member). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectAccess(user, projectId);

    const rows = await query<DbRow[]>(
      `SELECT rt.id, rt.title, rt.priority, rt.assignee_id, rt.estimated_hours,
              rt.recurrence, rt.next_run, rt.is_active, u.name AS assignee_name
         FROM recurring_tasks rt LEFT JOIN users u ON u.id = rt.assignee_id
        WHERE rt.project_id = ? ORDER BY rt.next_run ASC`,
      [projectId]
    );
    return json({
      recurring: rows.map((r) => ({ ...r, is_active: Boolean(r.is_active) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST — create a recurring task definition (admin/lead). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectManage(user, projectId);

    const data = createRecurringTaskSchema.parse(
      await req.json().catch(() => ({}))
    );
    if (data.assigneeId) {
      const m = await query<DbRow[]>(
        `SELECT id FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`,
        [projectId, data.assigneeId]
      );
      if (!m.length) throw new ApiError(400, "Assignee must be a project member");
    }

    const result = (await query<DbResult>(
      `INSERT INTO recurring_tasks
         (project_id, title, description, priority, assignee_id, estimated_hours,
          recurrence, next_run, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        data.title,
        data.description ?? null,
        data.priority ?? "medium",
        data.assigneeId ?? null,
        data.estimatedHours ?? null,
        data.recurrence,
        data.nextRun,
        user.id,
      ]
    )) as unknown as DbResult;

    await logActivity({
      userId: user.id,
      action: "recurring_task.created",
      entityType: "project",
      entityId: projectId,
      metadata: { title: data.title, recurrence: data.recurrence },
    });

    const [row] = await query<DbRow[]>(
      `SELECT rt.id, rt.title, rt.priority, rt.assignee_id, rt.estimated_hours,
              rt.recurrence, rt.next_run, rt.is_active, u.name AS assignee_name
         FROM recurring_tasks rt LEFT JOIN users u ON u.id = rt.assignee_id
        WHERE rt.id = ?`,
      [result.insertId]
    );
    return json({ recurring: { ...row, is_active: Boolean(row.is_active) } }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
