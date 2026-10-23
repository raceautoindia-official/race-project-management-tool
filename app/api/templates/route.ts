import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { saveTemplateSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** GET — list project templates (admin). */
export async function GET() {
  try {
    // Anyone may see what their department — and every other one — has
    // made. Hiding a template helps nobody; making one is the restricted part.
    await requireUser();
    const rows = await query<DbRow[]>(
      `SELECT t.id, t.name, t.description, t.department, t.created_at,
              u.name AS created_by_name,
              JSON_LENGTH(t.data, '$.tasks') AS task_count,
              JSON_LENGTH(t.data, '$.labels') AS label_count,
              JSON_LENGTH(t.data, '$.milestones') AS milestone_count,
              JSON_EXTRACT(t.data, '$.tasks[*].title') AS task_titles
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
    // Anyone may write down the shape of work they know. A template is not
    // dangerous: it fills a form in, and the next person edits every field
    // before anything is created. Removing one is an admin's job.
    const admin = await requireUser();
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

    // The way each task was split, as subtask titles (people and dates are
    // this project's own; the shape is what repeats).
    const subRows = tasks.length
      ? await query<DbRow[]>(
          `SELECT task_id, title FROM subtasks
            WHERE status <> 'cancelled' AND task_id IN (${tasks.map(() => "?").join(",")})
            ORDER BY position, id`,
          tasks.map((t) => t.id)
        )
      : [];
    const subtasksByTask = new Map<number, string[]>();
    for (const r of subRows) {
      subtasksByTask.set(r.task_id, [...(subtasksByTask.get(r.task_id) ?? []), r.title]);
    }

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
        subtasks: subtasksByTask.get(t.id as number) ?? [],
      })),
      milestones: milestones.map((m) => ({ name: m.name })),
    };

    // A template belongs to the department that made it unless it says
    // otherwise, which is almost always what was meant.
    const department = data.department ?? admin.department ?? null;
    const result = (await query<DbResult>(
      `INSERT INTO project_templates (name, description, department, data, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        data.name,
        data.description ?? null,
        department,
        JSON.stringify(templateData),
        admin.id,
      ]
    )) as unknown as DbResult;

    await logActivity({
      userId: admin.id,
      action: "template.created",
      entityType: "template",
      entityId: result.insertId,
      metadata: { name: data.name, fromProject: data.projectId, department },
    });

    return json(
      { template: { id: result.insertId, name: data.name, task_count: templateData.tasks.length } },
      201
    );
  } catch (err) {
    return errorResponse(err);
  }
}
