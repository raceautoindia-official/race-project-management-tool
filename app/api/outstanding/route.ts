import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/outstanding — the separate backlog list of overdue tasks and tasks
 * awaiting approval (#6). Scope:
 *   admin  → everything
 *   others → tasks they lead (project lead) or are assigned to
 */
export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();

    const where = ["(t.outstanding = 1 OR t.approval_status = 'pending')"];
    const params: unknown[] = [];
    if (user.role !== "admin") {
      where.push(`(
        t.assignee_id = ?
        OR t.project_id IN (
          SELECT project_id FROM project_members
          WHERE user_id = ? AND role_in_project = 'lead'
        )
      )`);
      params.push(user.id, user.id);
    }

    const rows = await query<DbRow[]>(
      `SELECT t.id, t.project_id, t.title, t.status, t.outstanding,
              t.approval_status, t.due_date, t.assignee_id,
              p.name AS project_name, a.name AS assignee_name,
              DATEDIFF(UTC_DATE(), t.due_date) AS days_overdue
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN users a ON a.id = t.assignee_id
        WHERE ${where.join(" AND ")}
        ORDER BY (t.approval_status = 'pending') DESC, t.due_date ASC`,
      params
    );

    return json({
      tasks: rows.map((t) => ({
        ...t,
        outstanding: Boolean(t.outstanding),
        days_overdue: t.days_overdue != null ? Number(t.days_overdue) : null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
