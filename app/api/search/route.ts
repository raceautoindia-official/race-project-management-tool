import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { query, DbRow } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return json({ projects: [], tasks: [] });
    }
    const like = `%${q}%`;
    const isAdmin = user.role === "admin";

    const projectScope = isAdmin
      ? ""
      : "AND p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)";
    const projectParams: unknown[] = isAdmin ? [like] : [like, user.id];
    const projects = await query<DbRow[]>(
      `SELECT p.id, p.name, p.status
       FROM projects p
       WHERE p.name LIKE ? ${projectScope}
       ORDER BY p.updated_at DESC
       LIMIT 6`,
      projectParams
    );

    const taskScope = isAdmin
      ? ""
      : "AND t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)";
    const taskParams: unknown[] = isAdmin ? [like] : [like, user.id];
    const tasks = await query<DbRow[]>(
      `SELECT t.id, t.title, t.status, t.project_id, p.name AS project_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE t.title LIKE ? ${taskScope}
       ORDER BY t.updated_at DESC
       LIMIT 8`,
      taskParams
    );

    return json({ projects, tasks });
  } catch (err) {
    return errorResponse(err);
  }
}
