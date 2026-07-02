import Link from "next/link";
import { requirePageUser } from "@/lib/page-guard";
import { getAdminDashboard, getMemberDashboard } from "@/lib/dashboard";
import AppShell from "@/components/AppShell";
import { StatCard, SectionCard, PageHeader } from "@/components/Cards";
import StatusChart from "@/components/StatusChart";
import { ProjectStatusBadge, TaskPriorityBadge } from "@/components/Badge";
import { formatDate, formatRelative, humanizeAction, STATUS_CHART_COLORS } from "@/lib/format";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

function statusChartData(counts: Record<TaskStatus, number>) {
  return (Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => ({
    name: TASK_STATUS_LABELS[s],
    value: counts[s],
    color: STATUS_CHART_COLORS[s],
  }));
}

export default async function DashboardPage() {
  const user = await requirePageUser();

  return (
    <AppShell user={user}>
      {user.role === "admin" ? (
        <AdminDashboard />
      ) : (
        <MemberDashboard userId={user.id} name={user.name} />
      )}
    </AppShell>
  );
}

async function AdminDashboard() {
  const data = await getAdminDashboard();
  return (
    <>
      <PageHeader
        title="Admin Dashboard"
        subtitle="Organization-wide overview of users, projects, and tasks."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Users" value={data.totals.users} />
        <StatCard
          label="Projects"
          value={data.totals.projects}
          hint={`${data.totals.activeProjects} active`}
        />
        <StatCard label="Tasks" value={data.totals.tasks} />
        <StatCard
          label="Overdue tasks"
          value={data.overdue.length}
          accent={data.overdue.length ? "text-red-600" : "text-slate-900"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Tasks by status">
          <StatusChart data={statusChartData(data.tasksByStatus)} />
        </SectionCard>

        <SectionCard title="Overdue tasks">
          {data.overdue.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing overdue. 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.overdue.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <Link
                      href={`/projects/${t.project_id}`}
                      className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-600"
                    >
                      {t.title}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {t.project_name} · {t.assignee_name ?? "Unassigned"}
                    </div>
                  </div>
                  <span className="ml-3 shrink-0 text-xs font-medium text-red-600">
                    {formatDate(t.due_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          title="Recent activity"
          action={
            <Link
              href="/admin/activity"
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              View all
            </Link>
          }
        >
          {data.recentActivity.length === 0 ? (
            <p className="text-sm text-slate-400">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">
                    <span className="font-medium">{a.user_name ?? "System"}</span>{" "}
                    <span className="text-slate-500">
                      {humanizeAction(a.action).toLowerCase()}
                    </span>
                  </span>
                  <span className="text-xs text-slate-400">
                    {formatRelative(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  );
}

async function MemberDashboard({ userId, name }: { userId: number; name: string }) {
  const data = await getMemberDashboard(userId);
  return (
    <>
      <PageHeader
        title={`Welcome, ${name.split(" ")[0]}`}
        subtitle="Your tasks and projects at a glance."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open tasks" value={data.openCount} />
        <StatCard label="In progress" value={data.tasksByStatus.in_progress} />
        <StatCard label="Completed" value={data.tasksByStatus.done} />
        <StatCard
          label="Overdue"
          value={data.overdueCount}
          accent={data.overdueCount ? "text-red-600" : "text-slate-900"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="My tasks by status">
          <StatusChart data={statusChartData(data.tasksByStatus)} />
        </SectionCard>

        <SectionCard
          title="Upcoming tasks"
          action={
            <Link
              href="/my-tasks"
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              My tasks
            </Link>
          }
        >
          {data.upcoming.length === 0 ? (
            <p className="text-sm text-slate-400">No open tasks assigned to you.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.upcoming.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link
                      href={`/projects/${t.project_id}`}
                      className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-600"
                    >
                      {t.title}
                    </Link>
                    <div className="text-xs text-slate-400">{t.project_name}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <TaskPriorityBadge priority={t.priority} />
                    <span className="text-xs text-slate-500">
                      {t.due_date ? formatDate(t.due_date) : "No due date"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          title="My projects"
          action={
            <Link
              href="/projects"
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              All projects
            </Link>
          }
        >
          {data.projects.length === 0 ? (
            <p className="text-sm text-slate-400">
              You are not a member of any projects yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.projects.map((p) => {
                const total = Number(p.task_count);
                const done = Number(p.done_count);
                const pct = total ? Math.round((done / total) * 100) : 0;
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="rounded-lg border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800">{p.name}</span>
                      <ProjectStatusBadge status={p.status} />
                    </div>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full bg-indigo-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {done}/{total} tasks done ({pct}%)
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
