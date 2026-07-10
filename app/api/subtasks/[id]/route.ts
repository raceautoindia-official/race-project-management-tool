import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertTaskEdit } from "@/lib/rbac";
import { updateSubtaskSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

async function loadSubtask(subtaskId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT s.id, s.task_id, s.title, s.is_done, s.position,
            t.project_id, t.assignee_id
     FROM subtasks s JOIN tasks t ON t.id = s.task_id
     WHERE s.id = ? LIMIT 1`,
    [subtaskId]
  );
  if (!rows.length) throw new ApiError(404, "Subtask not found");
  return rows[0];
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const subtaskId = Number(id);
    if (!Number.isInteger(subtaskId)) throw new ApiError(400, "Invalid id");

    const sub = await loadSubtask(subtaskId);
    await assertTaskEdit(user, {
      project_id: sub.project_id,
      assignee_id: sub.assignee_id,
    });

    const body = await req.json().catch(() => ({}));
    const data = updateSubtaskSchema.parse(body);

    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.title !== undefined) {
      sets.push("title = ?");
      values.push(data.title);
    }
    if (data.is_done !== undefined) {
      sets.push("is_done = ?");
      values.push(data.is_done);
    }
    values.push(subtaskId);
    await query(`UPDATE subtasks SET ${sets.join(", ")} WHERE id = ?`, values);

    const updated = await loadSubtask(subtaskId);
    return json({
      subtask: {
        id: updated.id,
        task_id: updated.task_id,
        title: updated.title,
        is_done: Boolean(updated.is_done),
        position: updated.position,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const subtaskId = Number(id);
    if (!Number.isInteger(subtaskId)) throw new ApiError(400, "Invalid id");

    const sub = await loadSubtask(subtaskId);
    await assertTaskEdit(user, {
      project_id: sub.project_id,
      assignee_id: sub.assignee_id,
    });

    await query(`DELETE FROM subtasks WHERE id = ?`, [subtaskId]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
