import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { fetchTasks, utcSql } from "@/lib/tasks";
import { buildTaskPdf } from "@/lib/pdf";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/tasks/:id/pdf — download the task as a PDF (any project member). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const [task] = await fetchTasks("t.id = ?", [taskId]);
    if (!task) throw new ApiError(404, "Task not found");
    await assertProjectAccess(user, task.project_id);

    const [subtasks, comments, attachments, [logged]] = await Promise.all([
      query<DbRow[]>(
        `SELECT title, is_done FROM subtasks WHERE task_id = ? ORDER BY position, id`,
        [taskId]
      ),
      query<DbRow[]>(
        `SELECT u.name AS user_name, tc.body, ${utcSql("tc.created_at")} AS created_at
           FROM task_comments tc LEFT JOIN users u ON u.id = tc.user_id
          WHERE tc.task_id = ? ORDER BY tc.created_at, tc.id`,
        [taskId]
      ),
      query<DbRow[]>(
        `SELECT a.filename, a.size_bytes, u.name AS uploader_name
           FROM task_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
          WHERE a.task_id = ? ORDER BY a.created_at`,
        [taskId]
      ),
      query<DbRow[]>(
        `SELECT COALESCE(SUM(minutes), 0) AS total FROM task_time_logs WHERE task_id = ?`,
        [taskId]
      ),
    ]);

    const pdf = await buildTaskPdf({
      task: task as unknown as Task,
      subtasks: subtasks.map((s) => ({ title: s.title, is_done: Boolean(s.is_done) })),
      comments: comments.map((c) => ({
        user_name: c.user_name,
        body: c.body,
        created_at: c.created_at,
      })),
      attachments: attachments.map((a) => ({
        filename: a.filename,
        size_bytes: Number(a.size_bytes),
        uploader_name: a.uploader_name,
      })),
      loggedMinutes: Number(logged.total),
      generatedBy: user.name,
    });

    const slug = String(task.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
    const filename = `task-${taskId}${slug ? `-${slug}` : ""}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
