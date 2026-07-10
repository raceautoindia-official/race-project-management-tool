import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { templateWorkbookBuffer } from "@/lib/excel";

type Params = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/tasks/template — blank .xlsx import template. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectAccess(user, projectId);

    const members = await query<DbRow[]>(
      `SELECT u.emp_id, u.name FROM project_members pm
         JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?
        ORDER BY u.name`,
      [projectId]
    );
    const buffer = await templateWorkbookBuffer(
      members.map((m) => ({ empId: m.emp_id as string, name: m.name as string }))
    );

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="task-import-template.xlsx"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
