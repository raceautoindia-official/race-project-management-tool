import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { tasksWorkbookBuffer, type TaskExportRow } from "@/lib/excel";

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

    const buffer = await tasksWorkbookBuffer(rows as unknown as TaskExportRow[]);
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
