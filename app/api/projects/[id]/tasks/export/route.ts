import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { toCsv, csvResponse } from "@/lib/csv";
import { TASK_STATUS_LABELS, type TaskStatus, type WorkType } from "@/lib/types";
import { WORK_TYPE_LABELS } from "@/lib/workflow";
import { utcSql } from "@/lib/tasks";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    const { project } = await assertProjectAccess(user, projectId);

    const rows = await query<DbRow[]>(
      `SELECT t.id, t.title, t.task_type, t.status, t.priority, t.due_date,
              a.name AS assignee_name, c.name AS creator_name,
              ${utcSql("t.created_at")} AS created_at,
              rq.name AS requester_name, ap.name AS approver_name,
              so.name AS signer_name, t.signed_off_at,
              (SELECT GROUP_CONCAT(l.name ORDER BY l.name SEPARATOR '; ')
               FROM task_labels tl JOIN labels l ON l.id = tl.label_id
               WHERE tl.task_id = t.id) AS labels
       FROM tasks t
       LEFT JOIN users a ON a.id = t.assignee_id
       LEFT JOIN users c ON c.id = t.created_by
       LEFT JOIN users rq ON rq.id = t.requested_by
       LEFT JOIN users ap ON ap.id = t.request_approved_by
       LEFT JOIN users so ON so.id = t.signed_off_by
       WHERE t.project_id = ?
       ORDER BY FIELD(t.status,'todo','in_progress','review','done'), t.priority DESC`,
      [projectId]
    );

    const csv = toCsv(
      [
        "ID", "Title", "Type", "Status", "Priority", "Assignee", "Due date", "Labels",
        "Requested by", "Approved by", "Signed off by", "Signed off at (UTC)",
        "Created by", "Created at (UTC)",
      ],
      rows.map((r) => [
        r.id,
        r.title,
        WORK_TYPE_LABELS[r.task_type as WorkType] ?? r.task_type,
        TASK_STATUS_LABELS[r.status as TaskStatus] ?? r.status,
        r.priority,
        r.assignee_name ?? "",
        r.due_date ?? "",
        r.labels ?? "",
        r.requester_name ?? "",
        r.approver_name ?? "",
        r.signer_name ?? "",
        r.signed_off_at ?? "",
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
