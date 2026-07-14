import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectManage } from "@/lib/rbac";
import { updateMilestoneSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

async function loadMilestone(msId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT id, project_id, name, due_date, is_done FROM milestones WHERE id = ? LIMIT 1`,
    [msId]
  );
  if (!rows.length) throw new ApiError(404, "Milestone not found");
  return rows[0];
}

/** PATCH — rename / re-date / toggle done (admin/lead). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const msId = Number(id);
    if (!Number.isInteger(msId)) throw new ApiError(400, "Invalid id");
    const ms = await loadMilestone(msId);
    await assertProjectManage(user, ms.project_id);

    const data = updateMilestoneSchema.parse(await req.json().catch(() => ({})));
    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) {
      sets.push("name = ?");
      values.push(data.name);
    }
    if (data.dueDate !== undefined) {
      sets.push("due_date = ?");
      values.push(data.dueDate);
    }
    if (data.isDone !== undefined) {
      sets.push("is_done = ?", "completed_at = ?");
      values.push(data.isDone ? 1 : 0, data.isDone ? new Date() : null);
    }
    if (sets.length) {
      values.push(msId);
      await query(`UPDATE milestones SET ${sets.join(", ")} WHERE id = ?`, values);
    }
    const updated = await loadMilestone(msId);
    return json({ milestone: { ...updated, is_done: Boolean(updated.is_done) } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE — admin/lead. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const msId = Number(id);
    if (!Number.isInteger(msId)) throw new ApiError(400, "Invalid id");
    const ms = await loadMilestone(msId);
    await assertProjectManage(user, ms.project_id);
    await query(`DELETE FROM milestones WHERE id = ?`, [msId]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
