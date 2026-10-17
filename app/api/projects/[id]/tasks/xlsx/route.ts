import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { tasksWorkbookBuffer, type SubtaskExportRow, type TaskExportRow } from "@/lib/excel";
import { effectiveWeights } from "@/lib/work-engine";

type Params = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/tasks/xlsx — export the project's tasks as .xlsx. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    const { project } = await assertProjectAccess(user, projectId);

    const rows = await query<DbRow[]>(
      `SELECT t.title, t.description, t.status, t.priority,
              t.estimated_hours, t.due_date, a.emp_id AS assignee_emp_id
         FROM tasks t
         LEFT JOIN users a ON a.id = t.assignee_id
        WHERE t.project_id = ?
        ORDER BY t.created_at DESC`,
      [projectId]
    );

    // Each task's subtasks, in order, with their share of the task.
    const subRows = await query<DbRow[]>(
      `SELECT s.id, s.task_id, t.title AS task_title, s.title, u.emp_id AS assignee_emp_id,
              s.status, s.start_date, s.due_date, s.weight, s.weight_mode
         FROM subtasks s
         JOIN tasks t ON t.id = s.task_id
         LEFT JOIN users u ON u.id = s.assignee_id
        WHERE t.project_id = ?
        ORDER BY t.created_at DESC, s.position, s.id`,
      [projectId]
    );
    const byTask = new Map<number, DbRow[]>();
    for (const s of subRows) byTask.set(s.task_id, [...(byTask.get(s.task_id) ?? []), s]);
    const subtasks: SubtaskExportRow[] = [];
    for (const list of byTask.values()) {
      const w = effectiveWeights(list.map((s) => ({ id: s.id, weight: s.weight, weight_mode: s.weight_mode, cancelled: s.status === "cancelled" })));
      for (const s of list) {
        subtasks.push({
          task_title: s.task_title,
          title: s.title,
          assignee_emp_id: s.assignee_emp_id ?? null,
          status: s.status,
          start_date: s.start_date ?? null,
          due_date: s.due_date ?? null,
          weight: w.get(s.id) ?? 0,
        });
      }
    }

    const buffer = await tasksWorkbookBuffer(rows as unknown as TaskExportRow[], subtasks);
    const safeName = String(project.name ?? "project")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}-tasks.xlsx"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
