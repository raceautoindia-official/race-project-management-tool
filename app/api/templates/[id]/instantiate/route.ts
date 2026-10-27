import { NextRequest } from "next/server";
import { pool, query, DbRow, DbResult } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { instantiateTemplateSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

interface TemplateData {
  labels?: { name: string; color: string }[];
  tasks?: {
    title: string;
    description: string | null;
    priority: string;
    estimated_hours: number | null;
    labelNames?: string[];
    /** Subtask titles (templates saved since the 2026-10-17 redesign). */
    subtasks?: string[];
  }[];
  milestones?: { name: string }[];
}

/** POST /api/templates/:id/instantiate — create a new project from a template (admin). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const tId = Number(id);
    if (!Number.isInteger(tId)) throw new ApiError(400, "Invalid id");
    const input = instantiateTemplateSchema.parse(await req.json().catch(() => ({})));
    const { name } = input;

    // Whoever the form named runs it (the admin by default); they must be
    // someone who can still sign in.
    const ownerId = input.ownerId ?? admin.id;
    if (ownerId !== admin.id) {
      const owner = await query<DbRow[]>(`SELECT id FROM users WHERE id = ? AND is_active = TRUE LIMIT 1`, [ownerId]);
      if (!owner.length) throw new ApiError(400, "The project manager you chose can't be found or has left");
    }

    const rows = await query<DbRow[]>(
      `SELECT data FROM project_templates WHERE id = ? LIMIT 1`,
      [tId]
    );
    if (!rows.length) throw new ApiError(404, "Template not found");
    const raw = rows[0].data;
    const data: TemplateData =
      typeof raw === "string" ? JSON.parse(raw) : (raw as TemplateData);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [pRes] = await conn.execute(
        // A template carries no department: it is a shape of work, not a
        // team's work. The project lands where the form says, or where
        // whoever created it belongs. No start date given means today.
        `INSERT INTO projects (name, description, department, status, owner_id, start_date, due_date)
         VALUES (?, ?, ?, 'active', ?, COALESCE(?, CURRENT_DATE()), ?)`,
        [
          name,
          input.description ?? null,
          input.department ?? admin.department ?? null,
          ownerId,
          input.startDate ?? null,
          input.dueDate ?? null,
        ]
      );
      const projectId = (pRes as DbResult).insertId;
      // The owner leads it; the people the form named are on it.
      await conn.execute(
        `INSERT INTO project_members (project_id, user_id, role_in_project)
         VALUES (?, ?, 'lead')`,
        [projectId, ownerId]
      );
      for (const memberId of new Set(input.memberIds ?? [])) {
        if (memberId === ownerId) continue;
        await conn.execute(
          `INSERT IGNORE INTO project_members (project_id, user_id, role_in_project)
           VALUES (?, ?, 'member')`,
          [projectId, memberId]
        );
      }

      const labelIdByName = new Map<string, number>();
      for (const l of data.labels ?? []) {
        const [lRes] = await conn.execute(
          `INSERT INTO labels (project_id, name, color) VALUES (?, ?, ?)`,
          [projectId, l.name, l.color]
        );
        labelIdByName.set(l.name, (lRes as DbResult).insertId);
      }

      for (const t of data.tasks ?? []) {
        const [tRes] = await conn.execute(
          `INSERT INTO tasks
             (project_id, title, description, status, priority, estimated_hours, created_by,
              requested_by, request_approved_by, request_approved_at)
           VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
          [
            projectId,
            t.title,
            t.description ?? null,
            t.priority ?? "medium",
            t.estimated_hours ?? null,
            admin.id,
            admin.id,
            admin.id,
          ]
        );
        const taskId = (tRes as DbResult).insertId;
        // Unassigned for now: whoever owns the task gives them out.
        for (const [i, title] of (t.subtasks ?? []).entries()) {
          await conn.execute(
            `INSERT INTO subtasks (task_id, title, position, created_by) VALUES (?, ?, ?, ?)`,
            [taskId, String(title).slice(0, 255), i, admin.id]
          );
        }
        for (const ln of t.labelNames ?? []) {
          const lid = labelIdByName.get(ln);
          if (lid) {
            await conn.execute(
              `INSERT IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)`,
              [taskId, lid]
            );
          }
        }
      }

      for (const m of data.milestones ?? []) {
        await conn.execute(
          `INSERT INTO milestones (project_id, name, created_by) VALUES (?, ?, ?)`,
          [projectId, m.name, admin.id]
        );
      }

      await conn.commit();

      await logActivity({
        userId: admin.id,
        action: "project.created_from_template",
        entityType: "project",
        entityId: projectId,
        metadata: { name, templateId: tId },
      });

      return json({ project: { id: projectId, name } }, 201);
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    return errorResponse(err);
  }
}
