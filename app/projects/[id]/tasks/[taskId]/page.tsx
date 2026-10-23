import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import TaskPageView from "@/components/work/TaskPageView";
import { fetchTasks } from "@/lib/tasks";
import { effectiveWeights } from "@/lib/work-engine";
import { projectLockReason } from "@/lib/workflow";
import type { Label, ProjectMember, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * A task on its own page: its owner, dates, weight and approved progress at
 * the top, the subtasks at the centre, and every existing part of a task
 * (specification, approval trail, sign-off, blockers, time, files, comments)
 * below. ?subtask=ID expands that subtask; &focus=blockers scrolls there.
 */
export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; taskId: string }>;
  searchParams: Promise<{ subtask?: string; focus?: string }>;
}) {
  const user = await requirePageUser();
  const { id, taskId: tid } = await params;
  const search = await searchParams;
  const projectId = Number(id);
  const taskId = Number(tid);
  if (!Number.isInteger(projectId) || !Number.isInteger(taskId)) notFound();

  const [project] = await query<DbRow[]>(
    `SELECT p.id, p.name, p.department, p.status, p.approval_status, p.owner_id,
            p.start_date, p.due_date, u.name AS owner_name, u.designation AS owner_designation,
            u.department AS owner_department
       FROM projects p LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.id = ? LIMIT 1`,
    [projectId]
  );
  if (!project) notFound();

  const [membership] = await query<DbRow[]>(
    `SELECT role_in_project FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`,
    [projectId, user.id]
  );
  const projectRole = (membership?.role_in_project as string | undefined) ?? null;
  if (user.role !== "admin" && !projectRole) redirect("/projects");
  const canManage = user.role === "admin" || projectRole === "lead" || project.owner_id === user.id;

  const [task] = (await fetchTasks("t.id = ? AND t.project_id = ?", [taskId, projectId])) as unknown as Task[];
  if (!task) notFound();

  const members = (await query<DbRow[]>(
    `SELECT pm.id, pm.project_id, pm.user_id, pm.role_in_project, u.name, u.email,
            u.department, u.designation
       FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY (pm.role_in_project = 'lead') DESC, u.name ASC`,
    [projectId]
  )) as unknown as ProjectMember[];

  // Siblings: for the blocker picker and this task's share of the project.
  const siblings = await query<DbRow[]>(
    `SELECT id, title, status, weight, weight_mode FROM tasks WHERE project_id = ? ORDER BY position, id`,
    [projectId]
  );
  const weight =
    effectiveWeights(siblings.map((r) => ({ id: r.id, weight: r.weight, weight_mode: r.weight_mode }))).get(taskId) ?? 0;

  const labels = (await query<DbRow[]>(
    `SELECT id, project_id, name, color FROM labels WHERE project_id = ? ORDER BY name`,
    [projectId]
  )) as unknown as Label[];

  const openSubtaskId = Number(search.subtask);

  return (
    <AppShell user={user}>
      <TaskPageView
        key={`${taskId}-${search.subtask ?? ""}`}
        initialTask={task}
        project={{
          id: project.id,
          name: project.name,
          owner_id: project.owner_id ?? null,
          owner_name: project.owner_name ?? null,
          owner_designation: project.owner_designation ?? null,
          owner_department: project.owner_department ?? null,
        }}
        projectReadOnlyReason={projectLockReason({ approval_status: project.approval_status, status: project.status })}
        weight={weight}
        members={members}
        labels={labels}
        projectTasks={siblings.map((r) => ({ id: r.id, title: r.title, status: r.status }))}
        currentUser={{ id: user.id, role: user.role, name: user.name, department: user.department }}
        canManage={canManage}
        openSubtaskId={Number.isInteger(openSubtaskId) ? openSubtaskId : null}
        focus={search.focus === "blockers" ? "blockers" : null}
      />
    </AppShell>
  );
}
