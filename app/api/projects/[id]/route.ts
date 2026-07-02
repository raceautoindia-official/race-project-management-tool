import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess, assertProjectManage } from "@/lib/rbac";
import { updateProjectSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

async function projectDetail(projectId: number) {
  const rows = await query<DbRow[]>(
    `SELECT p.id, p.name, p.description, p.status, p.owner_id,
            p.created_at, p.updated_at, u.name AS owner_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     WHERE p.id = ? LIMIT 1`,
    [projectId]
  );
  const project = rows[0];

  const members = await query<DbRow[]>(
    `SELECT pm.id, pm.project_id, pm.user_id, pm.role_in_project, u.name, u.email
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
     ORDER BY (pm.role_in_project = 'lead') DESC, u.name ASC`,
    [projectId]
  );

  const summaryRows = await query<DbRow[]>(
    `SELECT status, COUNT(*) AS c FROM tasks WHERE project_id = ? GROUP BY status`,
    [projectId]
  );
  const taskSummary = { todo: 0, in_progress: 0, review: 0, done: 0, total: 0 };
  for (const r of summaryRows) {
    const key = r.status as keyof typeof taskSummary;
    taskSummary[key] = Number(r.c);
    taskSummary.total += Number(r.c);
  }

  return { project, members, taskSummary };
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const { projectRole } = await assertProjectAccess(user, projectId);
    const detail = await projectDetail(projectId);

    return json({
      ...detail,
      myRole: projectRole,
      canManage: user.role === "admin" || projectRole === "lead",
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    await assertProjectManage(user, projectId);
    const body = await req.json().catch(() => ({}));
    const data = updateProjectSchema.parse(body);

    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) {
      sets.push("name = ?");
      values.push(data.name);
    }
    if (data.description !== undefined) {
      sets.push("description = ?");
      values.push(data.description ?? null);
    }
    if (data.status !== undefined) {
      sets.push("status = ?");
      values.push(data.status);
    }
    if (data.ownerId !== undefined && data.ownerId !== null) {
      sets.push("owner_id = ?");
      values.push(data.ownerId);
    }
    values.push(projectId);
    await query(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, values);

    await logActivity({
      userId: user.id,
      action: "project.updated",
      entityType: "project",
      entityId: projectId,
      metadata: data as Record<string, unknown>,
    });

    const detail = await projectDetail(projectId);
    return json(detail);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const rows = await query<DbRow[]>(
      `SELECT id FROM projects WHERE id = ? LIMIT 1`,
      [projectId]
    );
    if (!rows.length) throw new ApiError(404, "Project not found");

    await query(`DELETE FROM projects WHERE id = ?`, [projectId]);

    await logActivity({
      userId: admin.id,
      action: "project.deleted",
      entityType: "project",
      entityId: projectId,
    });

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
