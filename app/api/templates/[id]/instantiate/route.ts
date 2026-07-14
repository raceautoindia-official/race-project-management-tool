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
    const { name } = instantiateTemplateSchema.parse(
      await req.json().catch(() => ({}))
    );

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
        `INSERT INTO projects (name, description, status, owner_id)
         VALUES (?, NULL, 'active', ?)`,
        [name, admin.id]
      );
      const projectId = (pRes as DbResult).insertId;
      await conn.execute(
        `INSERT INTO project_members (project_id, user_id, role_in_project)
         VALUES (?, ?, 'lead')`,
        [projectId, admin.id]
      );

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
             (project_id, title, description, status, priority, estimated_hours, created_by)
           VALUES (?, ?, ?, 'todo', ?, ?, ?)`,
          [
            projectId,
            t.title,
            t.description ?? null,
            t.priority ?? "medium",
            t.estimated_hours ?? null,
            admin.id,
          ]
        );
        const taskId = (tRes as DbResult).insertId;
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
