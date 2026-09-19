import Link from "next/link";
import { requirePageAdmin } from "@/lib/page-guard";
import { getAdminDashboard } from "@/lib/dashboard";
import AppShell from "@/components/AppShell";
import { StatCard, SectionCard, PageHeader } from "@/components/Cards";
import { humanizeAction, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const user = await requirePageAdmin();
  const data = await getAdminDashboard();

  return (
    <AppShell user={user}>
      <PageHeader
        title="Admin"
        subtitle="Manage users, review activity, and monitor the workspace."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Users" value={data.totals.users} />
        <StatCard label="Projects" value={data.totals.projects} />
        <StatCard label="Tasks" value={data.totals.tasks} />
        <StatCard
          label="Overdue"
          value={data.overdue.length}
          accent={data.overdue.length ? "text-red-600" : "text-slate-900"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Accounts, roles and PINs live in the Attendance app; PMApp mirrors
            them on login and on `npm run seed`, so there is nothing to manage
            here — this used to link to a page that does not exist. */}
        <Link
          href="/team"
          className="rounded-xl border border-slate-200 bg-white p-6 hover:border-indigo-300 hover:shadow-sm"
        >
          <div className="text-lg font-semibold text-slate-800">People →</div>
          <p className="mt-1 text-sm text-slate-600">
            Everyone synced from the Attendance app, with their workload and status.
            Accounts, roles and PINs are managed there.
          </p>
        </Link>
        <Link
          href="/admin/activity"
          className="rounded-xl border border-slate-200 bg-white p-6 hover:border-indigo-300 hover:shadow-sm"
        >
          <div className="text-lg font-semibold text-slate-800">Activity log →</div>
          <p className="mt-1 text-sm text-slate-600">
            Full audit trail of logins, project and task changes.
          </p>
        </Link>
      </div>

      <div className="mt-6">
        <SectionCard
          title="Recent activity"
          action={
            <Link href="/admin/activity" className="inline-block py-1 text-sm font-medium text-indigo-600 hover:underline">
              View all
            </Link>
          }
        >
          {data.recentActivity.length === 0 ? (
            <p className="text-sm text-slate-500">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">
                    <span className="font-medium">{a.user_name ?? "System"}</span>{" "}
                    <span className="text-slate-600">
                      {humanizeAction(a.action).toLowerCase()}
                    </span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatRelative(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
