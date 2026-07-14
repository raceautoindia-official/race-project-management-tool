import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess, assertProjectManage } from "@/lib/rbac";
import { createMilestoneSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

/** GET — milestones for a project (any member). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectAccess(user, projectId);

    const rows = await query<DbRow[]>(
      `SELECT id, project_id, name, due_date, is_done, created_by
         FROM milestones WHERE project_id = ?
        ORDER BY (due_date IS NULL), due_date ASC, id ASC`,
      [projectId]
    );
    return json({
      milestones: rows.map((m) => ({ ...m, is_done: Boolean(m.is_done) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST — create a milestone (admin/lead). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectManage(user, projectId);

    const data = createMilestoneSchema.parse(await req.json().catch(() => ({})));
    const result = (await query<DbResult>(
      `INSERT INTO milestones (project_id, name, due_date, created_by)
       VALUES (?, ?, ?, ?)`,
      [projectId, data.name, data.dueDate ?? null, user.id]
    )) as unknown as DbResult;

    await logActivity({
      userId: user.id,
      action: "milestone.created",
      entityType: "project",
      entityId: projectId,
      metadata: { name: data.name },
    });

    return json(
      {
        milestone: {
          id: result.insertId,
          project_id: projectId,
          name: data.name,
          due_date: data.dueDate ?? null,
          is_done: false,
          created_by: user.id,
        },
      },
      201
    );
  } catch (err) {
    return errorResponse(err);
  }
}
