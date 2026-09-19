import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import ProjectBoard from "@/components/project/ProjectBoard";
import { fetchTaskRequests, fetchTasks } from "@/lib/tasks";
import type {
  Label,
  Milestone,
  ProjectMember,
  Task,
  TaskRequest,
} from "@/lib/types";

export const dynamic = "force-dynamic";

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
    `SELECT p.id, p.name, p.description, p.status, p.approval_status, p.owner_id,
            p.requested_by, p.requested_at, p.decided_at, p.decision_note,
            u.name AS owner_name, rq.name AS requester_name, dc.name AS decider_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     LEFT JOIN users rq ON rq.id = p.requested_by
     LEFT JOIN users dc ON dc.id = p.decided_by
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

  const tasks = (await fetchTasks("t.project_id = ?", [projectId])) as unknown as Task[];

  // Leads/admins review every task request; members see the ones they raised.
  const requests = (await fetchTaskRequests(
    canManage ? "r.project_id = ?" : "r.project_id = ? AND r.requested_by = ?",
    canManage ? [projectId] : [projectId, user.id]
  )) as unknown as TaskRequest[];

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
          approval_status: project.approval_status,
          requested_by: project.requested_by,
          requester_name: project.requester_name,
          requested_at: project.requested_at,
          decider_name: project.decider_name,
          decided_at: project.decided_at,
          decision_note: project.decision_note,
        }}
        initialTasks={tasks}
        initialMembers={members}
        initialLabels={labels}
        initialMilestones={milestones}
        initialRequests={requests}
        allUsers={allUsers.map((u) => ({ id: u.id, name: u.name, email: u.email }))}
        currentUser={{ id: user.id, role: user.role, name: user.name }}
        canManage={canManage}
      />
    </AppShell>
  );
}
