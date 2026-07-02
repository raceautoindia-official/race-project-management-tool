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

  return (
    <AppShell user={user}>
      <PageHeader
        title="My Tasks"
        subtitle="Every task assigned to you across all your projects."
      />
      <MyTasksView tasks={tasks} />
    </AppShell>
  );
}
