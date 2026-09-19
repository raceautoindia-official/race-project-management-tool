import { NextRequest } from "next/server";
import { pool, query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, getPagination, badRequest } from "@/lib/http";
import { createProjectSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { sendEmail, emailLayout, appBaseUrl, escapeHtml } from "@/lib/mailer";

export const dynamic = "force-dynamic";

const PROJECT_SELECT = `
  p.id, p.name, p.description, p.status, p.approval_status, p.owner_id,
  p.requested_by, p.requested_at, p.decided_by, p.decided_at, p.decision_note,
  p.created_at, p.updated_at,
  u.name AS owner_name, rq.name AS requester_name,
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
    } else if (status === "pending") {
      where.push("p.approval_status = 'pending'");
    } else if (status !== "all") {
      where.push("p.status <> 'archived'");
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query<DbRow[]>(
      `SELECT ${PROJECT_SELECT}
       FROM projects p
       LEFT JOIN users u ON u.id = p.owner_id
       LEFT JOIN users rq ON rq.id = p.requested_by
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

/**
 * POST /api/projects
 *   admin  → creates an approved project directly (as before).
 *   others → REQUESTS a project: it is created `pending` with the nominated
 *            lead (`leadId`) as owner/lead and the requester as a member, and
 *            stays read-only until that lead or an admin approves it.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const data = createProjectSchema.parse(body);
    const isAdmin = user.role === "admin";

    let ownerId: number;
    if (isAdmin) {
      ownerId = data.ownerId ?? user.id;
    } else {
      if (!data.leadId) {
        throw badRequest("Choose the lead who should approve this project");
      }
      if (data.leadId === user.id) {
        throw badRequest("Choose someone else as lead — a request can't be self-approved");
      }
      // The approver must already be a lead (of an approved project) or an admin.
      const lead = await query<DbRow[]>(
        `SELECT u.id FROM users u
          WHERE u.id = ? AND u.is_active = TRUE
            AND (u.role = 'admin' OR EXISTS (
              SELECT 1 FROM project_members pm
                JOIN projects p ON p.id = pm.project_id AND p.approval_status = 'approved'
               WHERE pm.user_id = u.id AND pm.role_in_project = 'lead'))
          LIMIT 1`,
        [data.leadId]
      );
      if (!lead.length) {
        throw badRequest("Choose an admin or an existing project lead to approve this project");
      }
      ownerId = data.leadId;
    }

    const conn = await pool.getConnection();
    let projectId: number;
    try {
      await conn.beginTransaction();
      const [res] = await conn.execute(
        isAdmin
          ? `INSERT INTO projects
               (name, description, status, approval_status, owner_id,
                requested_by, requested_at, decided_by, decided_at)
             VALUES (?, ?, ?, 'approved', ?, ?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP())`
          : `INSERT INTO projects
               (name, description, status, approval_status, owner_id,
                requested_by, requested_at)
             VALUES (?, ?, 'active', 'pending', ?, ?, UTC_TIMESTAMP())`,
        isAdmin
          ? [data.name, data.description ?? null, data.status ?? "active", ownerId, user.id, user.id]
          : [data.name, data.description ?? null, ownerId, user.id]
      );
      projectId = (res as DbResult).insertId;

      // Owner is always a project lead.
      await conn.execute(
        `INSERT INTO project_members (project_id, user_id, role_in_project)
         VALUES (?, ?, 'lead')
         ON DUPLICATE KEY UPDATE role_in_project = 'lead'`,
        [projectId, ownerId]
      );

      // Admins pick members up front; a requester joins their own project.
      const memberIds = isAdmin
        ? (data.memberIds ?? []).filter((id) => id !== ownerId)
        : [user.id];
      for (const memberId of memberIds) {
        await conn.execute(
          `INSERT IGNORE INTO project_members (project_id, user_id, role_in_project)
           VALUES (?, ?, 'member')`,
          [projectId, memberId]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    await logActivity({
      userId: user.id,
      action: isAdmin ? "project.created" : "project.requested",
      entityType: "project",
      entityId: projectId,
      metadata: isAdmin ? { name: data.name } : { name: data.name, leadId: ownerId },
    });

    if (!isAdmin) {
      const link = `/projects/${projectId}`;
      await notify(
        ownerId,
        "project_requested",
        `${user.name} requested project "${data.name}" — awaiting your approval`,
        link
      );
      const [lead] = await query<DbRow[]>(`SELECT email FROM users WHERE id = ?`, [ownerId]);
      await sendEmail({
        to: [lead?.email],
        subject: `Project approval requested: ${data.name}`,
        html: emailLayout(
          "Project approval requested",
          `<p><strong>${escapeHtml(user.name)}</strong> requested a new project <strong>${escapeHtml(data.name)}</strong> and nominated you as lead.</p>
           <p><a href="${appBaseUrl()}${link}">Review the request →</a></p>`
        ),
      });
      const admins = await query<DbRow[]>(
        `SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE AND id NOT IN (?, ?)`,
        [user.id, ownerId]
      );
      for (const a of admins) {
        await notify(
          a.id,
          "project_requested",
          `${user.name} requested project "${data.name}" — awaiting approval`,
          link
        );
      }
    }

    return json(
      {
        project: {
          id: projectId,
          name: data.name,
          description: data.description ?? null,
          owner_id: ownerId,
          approval_status: isAdmin ? "approved" : "pending",
        },
      },
      201
    );
  } catch (err) {
    return errorResponse(err);
  }
}
