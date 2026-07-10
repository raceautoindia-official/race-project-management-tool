import { query, DbRow } from "./db";
import { forbidden, notFound } from "./http";
import type { ProjectRole, User } from "./types";

/**
 * Is this user a "manager" of the project — i.e. allowed to create/edit/delete
 * tasks, manage members, and change project settings? Admins always are;
 * otherwise only the project lead (head).
 */
export function canManageProject(
  user: User,
  projectRole: ProjectRole | null
): boolean {
  return user.role === "admin" || projectRole === "lead";
}

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
  if (canManageProject(user, projectRole)) return project;
  throw forbidden("Only an admin or project lead can do this");
}

/**
 * Ensure the user may modify a specific task's execution state (status,
 * logged hours, checklist). Managers (admin/lead) may edit any task in the
 * project; a plain member may edit ONLY a task assigned to them. Returns
 * whether the caller is a manager so routes can widen what fields are allowed.
 */
export async function assertTaskEdit(
  user: User,
  task: { project_id: number; assignee_id: number | null }
): Promise<{ manager: boolean }> {
  const { projectRole } = await assertProjectAccess(user, task.project_id);
  if (canManageProject(user, projectRole)) return { manager: true };
  if (task.assignee_id === user.id) return { manager: false };
  throw forbidden(
    "Only an admin, the project lead, or the task's assignee can change this task"
  );
}
