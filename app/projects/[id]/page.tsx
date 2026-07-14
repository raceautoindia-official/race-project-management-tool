import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import ProjectBoard from "@/components/project/ProjectBoard";
import { attachTaskMeta } from "@/lib/tasks";
import type { Label, Milestone, ProjectMember, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

const TASK_SELECT = `
  t.id, t.project_id, t.title, t.description, t.status, t.priority,
  t.estimated_hours, t.spent_hours, t.is_additional, t.parent_task_id,
  t.assignee_id, t.created_by, t.due_date, t.start_date, t.created_at, t.updated_at,
  a.name AS assignee_name, c.name AS creator_name,
  (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
`;

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const projectRows = await query<DbRow[]>(
    `SELECT p.id, p.name, p.description, p.status, p.owner_id, u.name AS owner_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     WHERE p.id = ? LIMIT 1`,
    [projectId]
  );
  const project = projectRows[0];
  if (!project) notFound();

  const membershipRows = await query<DbRow[]>(
    `SELECT role_in_project FROM project_members
     WHERE project_id = ? AND user_id = ? LIMIT 1`,
    [projectId, user.id]
  );
  const projectRole = membershipRows[0]?.role_in_project ?? null;

  // Members may only view projects they belong to; admins may view all.
  if (user.role !== "admin" && !projectRole) {
    redirect("/projects");
  }
  const canManage = user.role === "admin" || projectRole === "lead";

  const taskRows = await query<DbRow[]>(
    `SELECT ${TASK_SELECT}
     FROM tasks t
     LEFT JOIN users a ON a.id = t.assignee_id
     LEFT JOIN users c ON c.id = t.created_by
     WHERE t.project_id = ?
     ORDER BY t.created_at DESC`,
    [projectId]
  );
  await attachTaskMeta(taskRows);
  const tasks = taskRows.map((t) => ({
    ...t,
    comment_count: Number(t.comment_count),
  })) as unknown as Task[];

  const labelRows = await query<DbRow[]>(
    `SELECT id, project_id, name, color FROM labels WHERE project_id = ? ORDER BY name`,
    [projectId]
  );
  const labels = labelRows as unknown as Label[];

  const memberRows = await query<DbRow[]>(
    `SELECT pm.id, pm.project_id, pm.user_id, pm.role_in_project, u.name, u.email
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
     ORDER BY (pm.role_in_project = 'lead') DESC, u.name ASC`,
    [projectId]
  );
  const members = memberRows as unknown as ProjectMember[];

  const milestoneRows = await query<DbRow[]>(
    `SELECT id, project_id, name, due_date, is_done, created_by
     FROM milestones WHERE project_id = ?
     ORDER BY (due_date IS NULL), due_date ASC, id ASC`,
    [projectId]
  );
  const milestones = milestoneRows.map((m) => ({
    ...m,
    is_done: Boolean(m.is_done),
  })) as unknown as Milestone[];

  let allUsers: DbRow[] = [];
  if (canManage) {
    allUsers = await query<DbRow[]>(
      `SELECT id, name, email FROM users WHERE is_active = TRUE ORDER BY name`
    );
  }

  return (
    <AppShell user={user}>
      <ProjectBoard
        project={{
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          owner_id: project.owner_id,
          owner_name: project.owner_name,
        }}
        initialTasks={tasks}
        initialMembers={members}
        initialLabels={labels}
        initialMilestones={milestones}
        allUsers={allUsers.map((u) => ({ id: u.id, name: u.name, email: u.email }))}
        currentUser={{ id: user.id, role: user.role }}
        canManage={canManage}
      />
    </AppShell>
  );
}
