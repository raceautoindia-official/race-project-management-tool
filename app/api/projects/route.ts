import { NextRequest } from "next/server";
import { pool, query, DbRow, DbResult } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { json, errorResponse, getPagination } from "@/lib/http";
import { createProjectSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const PROJECT_SELECT = `
  p.id, p.name, p.description, p.status, p.owner_id,
  p.created_at, p.updated_at,
  u.name AS owner_name,
  (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
`;

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(req.url);
    const search = (searchParams.get("search") ?? "").trim();
    const status = searchParams.get("status") ?? "";
    const { page, pageSize, offset } = getPagination(searchParams);

    const where: string[] = [];
    const params: unknown[] = [];
    const isMemberScope = user.role !== "admin";

    if (isMemberScope) {
      where.push(
        "p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)"
      );
      params.push(user.id);
    }
    if (search) {
      where.push("p.name LIKE ?");
      params.push(`%${search}%`);
    }
    if (["active", "completed", "archived"].includes(status)) {
      where.push("p.status = ?");
      params.push(status);
    } else if (status !== "all") {
      where.push("p.status <> 'archived'");
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query<DbRow[]>(
      `SELECT ${PROJECT_SELECT}
       FROM projects p
       LEFT JOIN users u ON u.id = p.owner_id
       ${whereSql}
       ORDER BY p.created_at DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const countRows = await query<DbRow[]>(
      `SELECT COUNT(*) AS total FROM projects p ${whereSql}`,
      params
    );

    return json({
      projects: rows.map((r) => ({
        ...r,
        member_count: Number(r.member_count),
        task_count: Number(r.task_count),
        done_count: Number(r.done_count),
      })),
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const data = createProjectSchema.parse(body);

    const ownerId = data.ownerId ?? admin.id;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [res] = await conn.execute(
        `INSERT INTO projects (name, description, status, owner_id)
         VALUES (?, ?, ?, ?)`,
        [data.name, data.description ?? null, data.status ?? "active", ownerId]
      );
      const projectId = (res as DbResult).insertId;

      // Owner is always a project lead.
      await conn.execute(
        `INSERT INTO project_members (project_id, user_id, role_in_project)
         VALUES (?, ?, 'lead')
         ON DUPLICATE KEY UPDATE role_in_project = 'lead'`,
        [projectId, ownerId]
      );

      const memberIds = (data.memberIds ?? []).filter((id) => id !== ownerId);
      for (const memberId of memberIds) {
        await conn.execute(
          `INSERT IGNORE INTO project_members (project_id, user_id, role_in_project)
           VALUES (?, ?, 'member')`,
          [projectId, memberId]
        );
      }
      await conn.commit();

      await logActivity({
        userId: admin.id,
        action: "project.created",
        entityType: "project",
        entityId: projectId,
        metadata: { name: data.name },
      });

      return json({ project: { id: projectId, ...data, owner_id: ownerId } }, 201);
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
