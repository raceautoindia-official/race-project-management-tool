import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import {
  assertProjectAccess,
  assertProjectManage,
  assertProjectWritable,
} from "@/lib/rbac";
import { addMemberSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    await assertProjectAccess(user, projectId);
    const members = await query<DbRow[]>(
      `SELECT pm.id, pm.project_id, pm.user_id, pm.role_in_project, u.name, u.email,
              u.department, u.designation
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? AND u.is_active = TRUE
       ORDER BY (pm.role_in_project = 'lead') DESC, u.name ASC`,
      [projectId]
    );
    return json({ members });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const project = await assertProjectManage(user, projectId);
    assertProjectWritable(project);
    const body = await req.json().catch(() => ({}));
    const data = addMemberSchema.parse(body);

    const exists = await query<DbRow[]>(
      `SELECT id FROM users WHERE id = ? AND is_active = TRUE LIMIT 1`,
      [data.userId]
    );
    if (!exists.length) throw new ApiError(404, "User not found");
    // The owner is always a lead (DELETE protects them the same way).
    if (data.userId === project.owner_id && (data.roleInProject ?? "member") !== "lead") {
      throw new ApiError(400, "The project owner must stay a lead");
    }

    await query(
      `INSERT INTO project_members (project_id, user_id, role_in_project)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE role_in_project = VALUES(role_in_project)`,
      [projectId, data.userId, data.roleInProject ?? "member"]
    );

    await logActivity({
      userId: user.id,
      action: "project.member_added",
      entityType: "project",
      entityId: projectId,
      metadata: { userId: data.userId },
    });
    await notify(
      data.userId,
      "project_added",
      `You were added to project "${project.name}"`,
      `/projects/${projectId}`
    );

    return json({ ok: true }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PATCH { userId, roleInProject } — make someone already on the project a
 * lead or an ordinary member again (admin / lead / owner). The owner always
 * stays a lead; give the project a new owner first (PATCH /api/projects/:id).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const project = await assertProjectManage(user, projectId);
    assertProjectWritable(project);
    const data = addMemberSchema.parse(await req.json().catch(() => ({})));
    const role = data.roleInProject ?? "member";
    if (data.userId === project.owner_id && role !== "lead") {
      throw new ApiError(400, "The project owner must stay a lead — make someone else the owner first");
    }
    const [member] = await query<DbRow[]>(
      `SELECT role_in_project FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`,
      [projectId, data.userId]
    );
    if (!member) throw new ApiError(404, "That person isn't on this project");
    if (member.role_in_project !== role) {
      await query(`UPDATE project_members SET role_in_project = ? WHERE project_id = ? AND user_id = ?`, [role, projectId, data.userId]);
      await logActivity({
        userId: user.id,
        action: "project.member_role_changed",
        entityType: "project",
        entityId: projectId,
        metadata: { userId: data.userId, from: member.role_in_project, to: role },
      });
      if (data.userId !== user.id) {
        await notify(
          data.userId,
          "project_role_changed",
          role === "lead"
            ? `You are now a lead of "${project.name}" — you can approve its tasks and sign them off`
            : `You are now a member (no longer a lead) of "${project.name}"`,
          `/projects/${projectId}`
        );
      }
    }
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const project = await assertProjectManage(user, projectId);
    assertProjectWritable(project);
    const { searchParams } = new URL(req.url);
    const memberId = Number(searchParams.get("userId"));
    if (!Number.isInteger(memberId)) throw new ApiError(400, "Invalid userId");

    if (memberId === project.owner_id) {
      throw new ApiError(400, "Remove or reassign the project owner first");
    }

    await query(
      `DELETE FROM project_members WHERE project_id = ? AND user_id = ?`,
      [projectId, memberId]
    );

    await logActivity({
      userId: user.id,
      action: "project.member_removed",
      entityType: "project",
      entityId: projectId,
      metadata: { userId: memberId },
    });

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
