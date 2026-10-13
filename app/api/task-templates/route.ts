import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { saveTaskTemplateSchema } from "@/lib/validation";
import { SPEC_KEYS, specBodyKey } from "@/lib/workflow";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * Task templates: the New task form, filled in and saved with a name.
 *
 * A department's work repeats — the same inspection, the same drawing
 * release, the same specification every time. This stores that shape so the
 * next one is a choice from a dropdown rather than a retyping exercise.
 *
 * It is not a task: nothing exists until someone picks it, edits whatever
 * they like and presses Create.
 */

/** GET — every task template, newest first. Departments are a label, not a wall. */
export async function GET() {
  try {
    await requireUser();
    const rows = await query<DbRow[]>(
      `SELECT t.id, t.name, t.department, t.data, t.created_at,
              u.name AS created_by_name
         FROM task_templates t
         LEFT JOIN users u ON u.id = t.created_by
        ORDER BY t.name`
    );
    return json({ templates: rows });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST — save an existing task's shape as a template. */
export async function POST(req: NextRequest) {
  try {
    const author = await requireUser();
    const data = saveTaskTemplateSchema.parse(await req.json().catch(() => ({})));

    const [task] = await query<DbRow[]>(
      `SELECT t.id, t.title, t.description, t.task_type, t.priority,
              t.estimated_hours, ${SPEC_KEYS.map((k) => `t.${k}`).join(", ")}
         FROM tasks t WHERE t.id = ? LIMIT 1`,
      [data.taskId]
    );
    if (!task) throw new ApiError(404, "Task not found");

    const labels = await query<DbRow[]>(
      `SELECT l.name FROM task_labels tl
         JOIN labels l ON l.id = tl.label_id
        WHERE tl.task_id = ?`,
      [data.taskId]
    );

    // Stored under the names the form uses, so applying it is a copy rather
    // than a translation.
    const templateData: Record<string, unknown> = {
      // The template's name is the title a new task starts with. The old
      // task's own title described one occasion — "Inspect batch 42" is the
      // wrong thing to hand the person doing batch 43.
      title: data.name,
      description: task.description ?? null,
      taskType: task.task_type,
      priority: task.priority,
      estimatedHours: task.estimated_hours ?? null,
      labelNames: labels.map((l) => String(l.name)),
    };
    for (const key of SPEC_KEYS) {
      templateData[specBodyKey(key)] = (task[key] as string | null) ?? null;
    }

    const department = data.department ?? author.department ?? null;
    const result = (await query<DbResult>(
      `INSERT INTO task_templates (name, department, data, created_by)
       VALUES (?, ?, ?, ?)`,
      [data.name, department, JSON.stringify(templateData), author.id]
    )) as unknown as DbResult;

    await logActivity({
      userId: author.id,
      action: "task_template.created",
      entityType: "template",
      entityId: result.insertId,
      metadata: { name: data.name, fromTask: data.taskId, department },
    });

    return json(
      { template: { id: result.insertId, name: data.name, department } },
      201
    );
  } catch (err) {
    return errorResponse(err);
  }
}
