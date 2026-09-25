import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import MyTasksView from "@/components/MyTasksView";
import { attachTaskMeta } from "@/lib/tasks";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MyTasksPage() {
  const user = await requirePageUser();

  const rows = await query<DbRow[]>(
    `SELECT t.id, t.project_id, t.title, t.status, t.priority, t.due_date,
            p.name AS project_name
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE t.assignee_id = ?
     ORDER BY (t.due_date IS NULL), t.due_date ASC`,
    [user.id]
  );
  await attachTaskMeta(rows);
  const tasks = rows as unknown as Task[];

  // Live work in the projects this person belongs to, owned by someone else.
  // Membership is still the boundary — this shows what is going on around
  // you, not everything in the company.
  const teamRows = await query<DbRow[]>(
    `SELECT t.id, t.project_id, t.title, t.status, t.priority, t.due_date,
            p.name AS project_name, u.name AS assignee_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
        AND (t.assignee_id IS NULL OR t.assignee_id <> ?)
        AND t.signed_off_at IS NULL
        AND t.status <> 'done'
        AND p.status <> 'archived'
      ORDER BY (t.due_date IS NULL), t.due_date ASC, t.id`,
    [user.id, user.id]
  );
  await attachTaskMeta(teamRows);
  const projectTasks = teamRows as unknown as Task[];

  return (
    <AppShell user={user}>
      <PageHeader
        title="My Tasks"
        subtitle="Your own work, and what else is live on the projects you are on."
      />
      <MyTasksView tasks={tasks} projectTasks={projectTasks} />
    </AppShell>
  );
}
