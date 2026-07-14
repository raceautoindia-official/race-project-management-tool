import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectManage } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

async function load(rtId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT id, project_id, is_active FROM recurring_tasks WHERE id = ? LIMIT 1`,
    [rtId]
  );
  if (!rows.length) throw new ApiError(404, "Not found");
  return rows[0];
}

/** PATCH — toggle active (admin/lead). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const rtId = Number(id);
    if (!Number.isInteger(rtId)) throw new ApiError(400, "Invalid id");
    const rt = await load(rtId);
    await assertProjectManage(user, rt.project_id);
    const body = await req.json().catch(() => ({}));
    if (typeof body.isActive === "boolean") {
      await query(`UPDATE recurring_tasks SET is_active = ? WHERE id = ?`, [
        body.isActive ? 1 : 0,
        rtId,
      ]);
    }
    const [row] = await query<DbRow[]>(
      `SELECT rt.id, rt.title, rt.priority, rt.assignee_id, rt.estimated_hours,
              rt.recurrence, rt.next_run, rt.is_active, u.name AS assignee_name
         FROM recurring_tasks rt LEFT JOIN users u ON u.id = rt.assignee_id
        WHERE rt.id = ?`,
      [rtId]
    );
    return json({ recurring: { ...row, is_active: Boolean(row.is_active) } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE — admin/lead. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const rtId = Number(id);
    if (!Number.isInteger(rtId)) throw new ApiError(400, "Invalid id");
    const rt = await load(rtId);
    await assertProjectManage(user, rt.project_id);
    await query(`DELETE FROM recurring_tasks WHERE id = ?`, [rtId]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
