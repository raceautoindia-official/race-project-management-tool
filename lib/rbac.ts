import { query, DbRow } from "./db";
import { forbidden, notFound } from "./http";
import type { ProjectRole, User } from "./types";

/** Does this project exist? Returns the row or null. */
export async function findProject(projectId: number): Promise<DbRow | null> {
  const rows = await query<DbRow[]>(
    `SELECT * FROM projects WHERE id = ? LIMIT 1`,
    [projectId]
  );
  return rows[0] ?? null;
}

/** The membership role of a user in a project, or null if not a member. */
export async function getProjectRole(
  userId: number,
  projectId: number
): Promise<ProjectRole | null> {
  const rows = await query<DbRow[]>(
    `SELECT role_in_project FROM project_members
     WHERE project_id = ? AND user_id = ? LIMIT 1`,
    [projectId, userId]
  );
  return (rows[0]?.role_in_project as ProjectRole) ?? null;
}

/**
 * Ensure the user can view/work in a project. Admins always can. Members
 * must belong to it. Throws 404 if the project is missing, 403 if no access.
 * Returns the project row plus the caller's project role (admins: null).
 */
export async function assertProjectAccess(
  user: User,
  projectId: number
): Promise<{ project: DbRow; projectRole: ProjectRole | null }> {
  const project = await findProject(projectId);
  if (!project) throw notFound("Project not found");
  if (user.role === "admin") {
    return { project, projectRole: null };
  }
  const projectRole = await getProjectRole(user.id, projectId);
  if (!projectRole) throw forbidden("You are not a member of this project");
  return { project, projectRole };
}

/**
 * Ensure the user can modify project settings (edit/members). Admins or the
 * project lead. Throws if not allowed.
 */
export async function assertProjectManage(
  user: User,
  projectId: number
): Promise<DbRow> {
  const { project, projectRole } = await assertProjectAccess(user, projectId);
  if (user.role === "admin" || projectRole === "lead") return project;
  throw forbidden("Only an admin or project lead can do this");
}
