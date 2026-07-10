import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import OutstandingView, {
  type OutstandingTask,
} from "@/components/OutstandingView";

export const dynamic = "force-dynamic";

export default async function OutstandingPage() {
  const user = await requirePageUser();
  const isAdmin = user.role === "admin";

  // "Needs attention": overdue tasks + tasks submitted for review.
  const where = ["(t.outstanding = 1 OR t.status = 'review')"];
  const params: unknown[] = [];
  if (!isAdmin) {
    where.push(`(
      t.assignee_id = ?
      OR t.project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = ? AND role_in_project = 'lead'
      )
    )`);
    params.push(user.id, user.id);
  }

  const rows = await query<DbRow[]>(
    `SELECT t.id, t.project_id, t.title, t.status, t.outstanding,
            t.approval_status, t.due_date, t.assignee_id,
            p.name AS project_name, a.name AS assignee_name,
            DATEDIFF(UTC_DATE(), t.due_date) AS days_overdue
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users a ON a.id = t.assignee_id
      WHERE ${where.join(" AND ")}
      ORDER BY (t.status = 'review') DESC, t.due_date ASC`,
    params
  );

  // Project ids the (non-admin) user leads, for per-row approve/reject rights.
  let leadIds = new Set<number>();
  if (!isAdmin) {
    const lp = await query<DbRow[]>(
      `SELECT project_id FROM project_members
        WHERE user_id = ? AND role_in_project = 'lead'`,
      [user.id]
    );
    leadIds = new Set(lp.map((r) => r.project_id as number));
  }

  const tasks: OutstandingTask[] = rows.map((t) => ({
    id: t.id,
    project_id: t.project_id,
    title: t.title,
    project_name: t.project_name,
    assignee_name: t.assignee_name,
    due_date: t.due_date,
    status: t.status,
    outstanding: Boolean(t.outstanding),
    approval_status: t.approval_status,
    days_overdue: t.days_overdue != null ? Number(t.days_overdue) : null,
    can_manage: isAdmin || leadIds.has(t.project_id),
  }));

  return (
    <AppShell user={user}>
      <PageHeader
        title="Outstanding tasks"
        subtitle="Overdue work and tasks submitted for review — approve or send back."
      />
      <OutstandingView initial={tasks} />
    </AppShell>
  );
}
