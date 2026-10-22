import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess, assertTaskWritable } from "@/lib/rbac";
import { listTaskAttachments, saveAttachment } from "@/lib/attachments";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function loadTaskRef(taskId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT id, project_id, title FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  if (!rows.length) throw new ApiError(404, "Task not found");
  return rows[0];
}

/** GET — attachment metadata for a task and its subtasks (no blob data). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    await assertProjectAccess(user, task.project_id);

    return json({ attachments: await listTaskAttachments(taskId) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST (multipart 'file') — upload an attachment (any project member). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    await assertProjectAccess(user, task.project_id);
    await assertTaskWritable(taskId);

    return json({ attachment: await saveAttachment(req, user, taskId, null) }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
