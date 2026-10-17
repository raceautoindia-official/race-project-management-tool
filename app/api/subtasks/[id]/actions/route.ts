import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { subtaskActionSchema } from "@/lib/validation";
import { applySubtaskAction } from "@/lib/subtask-actions";
import { listSubtasks } from "@/lib/subtasks";
import { query, DbRow } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/subtasks/:id/actions — { action, note? } where action is one of
 * start | submit | approve | request_changes | reopen | cancel | restore.
 * Rules and permissions: lib/subtask-actions.ts. Returns the subtask and its
 * task's (possibly changed) status.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const subtaskId = Number((await params).id);
    if (!Number.isInteger(subtaskId)) throw new ApiError(400, "Invalid id");
    const { action, note } = subtaskActionSchema.parse(await req.json().catch(() => ({})));

    const status = await applySubtaskAction(user, subtaskId, action, note);
    const [row] = await query<DbRow[]>(
      `SELECT s.task_id, t.status AS task_status FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?`,
      [subtaskId]
    );
    const subtask = (await listSubtasks(row.task_id)).find((s) => s.id === subtaskId);
    return json({ status, subtask, taskStatus: row.task_status });
  } catch (err) {
    return errorResponse(err);
  }
}
