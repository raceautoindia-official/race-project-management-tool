import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { createSubtaskSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

async function taskProjectId(taskId: number): Promise<number> {
  const rows = await query<DbRow[]>(
    `SELECT project_id FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  if (!rows.length) throw new ApiError(404, "Task not found");
  return rows[0].project_id;
}

function mapSubtask(r: DbRow) {
  return {
    id: r.id,
    task_id: r.task_id,
    title: r.title,
    is_done: Boolean(r.is_done),
    position: r.position,
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const projectId = await taskProjectId(taskId);
    await assertProjectAccess(user, projectId);

    const rows = await query<DbRow[]>(
      `SELECT id, task_id, title, is_done, position FROM subtasks
       WHERE task_id = ? ORDER BY position ASC, id ASC`,
      [taskId]
    );
    return json({ subtasks: rows.map(mapSubtask) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const projectId = await taskProjectId(taskId);
    await assertProjectAccess(user, projectId);

    const body = await req.json().catch(() => ({}));
    const { title } = createSubtaskSchema.parse(body);

    const [{ nextPos }] = await query<DbRow[]>(
      `SELECT COALESCE(MAX(position) + 1, 0) AS nextPos FROM subtasks WHERE task_id = ?`,
      [taskId]
    );
    const result = (await query<DbResult>(
      `INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?)`,
      [taskId, title, nextPos]
    )) as unknown as DbResult;

    return json(
      {
        subtask: {
          id: result.insertId,
          task_id: taskId,
          title,
          is_done: false,
          position: nextPos,
        },
      },
      201
    );
  } catch (err) {
    return errorResponse(err);
  }
}
