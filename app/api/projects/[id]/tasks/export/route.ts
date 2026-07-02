import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { toCsv, csvResponse } from "@/lib/csv";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    const { project } = await assertProjectAccess(user, projectId);

    const rows = await query<DbRow[]>(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date,
              a.name AS assignee_name, c.name AS creator_name, t.created_at,
              (SELECT GROUP_CONCAT(l.name ORDER BY l.name SEPARATOR '; ')
               FROM task_labels tl JOIN labels l ON l.id = tl.label_id
               WHERE tl.task_id = t.id) AS labels
       FROM tasks t
       LEFT JOIN users a ON a.id = t.assignee_id
       LEFT JOIN users c ON c.id = t.created_by
       WHERE t.project_id = ?
       ORDER BY FIELD(t.status,'todo','in_progress','review','done'), t.priority DESC`,
      [projectId]
    );

    const csv = toCsv(
      ["ID", "Title", "Status", "Priority", "Assignee", "Due date", "Labels", "Created by", "Created at"],
      rows.map((r) => [
        r.id,
        r.title,
        TASK_STATUS_LABELS[r.status as TaskStatus] ?? r.status,
        r.priority,
        r.assignee_name ?? "",
        r.due_date ?? "",
        r.labels ?? "",
        r.creator_name ?? "",
        r.created_at,
      ])
    );

    const safe = String(project.name).replace(/[^\w.-]+/g, "_").slice(0, 40);
    return csvResponse(`tasks_${safe}.csv`, csv);
  } catch (err) {
    return errorResponse(err);
  }
}
