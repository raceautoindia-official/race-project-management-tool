import { requireUser } from "@/lib/auth";
import { query, DbRow } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const tasks = await query<DbRow[]>(
      `SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
              t.assignee_id, t.due_date, t.created_at, t.updated_at,
              p.name AS project_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE t.assignee_id = ?
       ORDER BY FIELD(t.status,'todo','in_progress','review','done'),
                (t.due_date IS NULL), t.due_date ASC`,
      [user.id]
    );
    return json({ tasks });
  } catch (err) {
    return errorResponse(err);
  }
}
