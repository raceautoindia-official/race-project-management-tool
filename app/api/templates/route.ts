import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { saveTemplateSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** GET — list project templates (admin). */
export async function GET(_req: NextRequest) {
  try {
    await requireAdmin();
    const rows = await query<DbRow[]>(
      `SELECT t.id, t.name, t.description, t.created_at, u.name AS created_by_name,
              JSON_LENGTH(t.data, '$.tasks') AS task_count
         FROM project_templates t LEFT JOIN users u ON u.id = t.created_by
        ORDER BY t.created_at DESC`
    );
    return json({ templates: rows });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST — save an existing project's structure as a reusable template (admin). */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const data = saveTemplateSchema.parse(await req.json().catch(() => ({})));

    const proj = await query<DbRow[]>(
      `SELECT id, name FROM projects WHERE id = ? LIMIT 1`,
      [data.projectId]
    );
    if (!proj.length) throw new ApiError(404, "Project not found");

    const labels = await query<DbRow[]>(
      `SELECT name, color FROM labels WHERE project_id = ?`,
      [data.projectId]
    );
    const tasks = await query<DbRow[]>(
      `SELECT id, title, description, priority, estimated_hours
         FROM tasks WHERE project_id = ? ORDER BY id`,
      [data.projectId]
    );
    const tlabels = await query<DbRow[]>(
      `SELECT tl.task_id, l.name
         FROM task_labels tl JOIN labels l ON l.id = tl.label_id
        WHERE l.project_id = ?`,
      [data.projectId]
    );
    const milestones = await query<DbRow[]>(
      `SELECT name FROM milestones WHERE project_id = ?`,
      [data.projectId]
    );

    const labelsByTask = new Map<number, string[]>();
    for (const r of tlabels) {
      const arr = labelsByTask.get(r.task_id) ?? [];
      arr.push(r.name);
      labelsByTask.set(r.task_id, arr);
    }

    const templateData = {
      labels: labels.map((l) => ({ name: l.name, color: l.color })),
      tasks: tasks.map((t) => ({
        title: t.title,
        description: t.description,
        priority: t.priority,
        estimated_hours: t.estimated_hours,
        labelNames: labelsByTask.get(t.id as number) ?? [],
      })),
      milestones: milestones.map((m) => ({ name: m.name })),
    };

    const result = (await query<DbResult>(
      `INSERT INTO project_templates (name, description, data, created_by)
       VALUES (?, ?, ?, ?)`,
      [data.name, data.description ?? null, JSON.stringify(templateData), admin.id]
    )) as unknown as DbResult;

    await logActivity({
      userId: admin.id,
      action: "template.created",
      entityType: "template",
      entityId: result.insertId,
      metadata: { name: data.name, fromProject: data.projectId },
    });

    return json(
      { template: { id: result.insertId, name: data.name, task_count: templateData.tasks.length } },
      201
    );
  } catch (err) {
    return errorResponse(err);
  }
}
