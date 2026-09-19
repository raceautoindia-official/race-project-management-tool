import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, errorResponse } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { buildIcs, icsResponse } from "@/lib/ics";
import { appBaseUrl } from "@/lib/mailer";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/tasks/:id/ics — the task's due date as a calendar entry. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const [task] = await query<DbRow[]>(
      `SELECT t.id, t.title, t.status, t.due_date, t.project_id, p.name AS project_name
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.id = ? LIMIT 1`,
      [taskId]
    );
    if (!task) throw new ApiError(404, "Task not found");
    await assertProjectAccess(user, task.project_id);
    if (!task.due_date) throw new ApiError(400, "This task has no due date");

    const link = `${appBaseUrl()}/projects/${task.project_id}`;
    const body = buildIcs([
      {
        uid: `task-${task.id}@pmapp`,
        summary: `Due: ${task.title}`,
        date: String(task.due_date).slice(0, 10),
        description: `${task.project_name} · ${task.status}\n${link}`,
        url: link,
      },
    ]);
    return icsResponse(`task-${task.id}.ics`, body);
  } catch (err) {
    return errorResponse(err);
  }
}
