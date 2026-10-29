import Link from "next/link";
import { requirePageAdmin } from "@/lib/page-guard";
import { getAdminDashboard } from "@/lib/dashboard";
import { getAdminOverview, type AdminOverview, type PortfolioRow } from "@/lib/admin-overview";
import { todayIST } from "@/lib/work-dates";
import AppShell from "@/components/AppShell";
import { SectionCard, PageHeader } from "@/components/Cards";
import EmailCheck from "@/components/EmailCheck";
import DepartmentLoadPanel from "@/components/DepartmentLoadPanel";
import Avatar from "@/components/Avatar";
import { HealthBadge, WorkProgress } from "@/components/work/kit";
import { humanizeAction, formatDate, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Control centre — an admin's home. An admin runs the organisation rather
 * than working a to-do list, so this answers their questions instead of a
 * member's: how is the portfolio doing, what is waiting on a decision, where
 * do reviews pile up, who is overloaded or idle, and which records need
 * fixing. Everything links to where it is acted on.
 */
export default async function ControlCentrePage() {
  const user = await requirePageAdmin();
  const today = todayIST();
  const [overview, org] = await Promise.all([getAdminOverview(user, today), getAdminDashboard()]);
  const { portfolio, decisions } = overview;

  const needsEye = portfolio.filter((p) => p.health === "off_track" || p.health === "at_risk").length;
  const overdueTasks = portfolio.reduce((n, p) => n + p.overdue_count, 0);
  const waiting =
    decisions.projectRequests +
    decisions.taskRequests +
    decisions.finishedTasks +
    decisions.finishedSubtasks +
    decisions.blockers +
    decisions.signOffs;
  const dateLine = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  });

  return (
    <AppShell user={user}>
      <PageHeader
        title="Control centre"
        subtitle={`How the organisation's work is going, and what needs you. ${dateLine}.`}
        figures={[
          { label: "Active projects", value: portfolio.length },
          { label: "Behind schedule", value: needsEye },
          { label: "Overdue tasks", value: overdueTasks },
          { label: "Waiting on a decision", value: waiting },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <DecisionsCard decisions={decisions} />
        <ReviewersCard reviewers={overview.reviewers} />
        <WorkloadCard people={overview.people} idle={overview.idle} />
      </div>

      <div className="mt-6">
        <PortfolioCard rows={portfolio} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <DataIssuesCard issues={overview.dataIssues} />
        <DepartmentLoadPanel rows={org.byDepartment} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
        <div className="space-y-6">
          <SectionCard title="Admin tools">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { href: "/admin/people", label: "People & levels", hint: "Departments, job titles, seniority" },
                { href: "/admin/activity", label: "Activity log", hint: "Every login and change" },
                { href: "/admin/documents", label: "Personal documents", hint: "Opening one is recorded" },
                { href: "/credentials", label: "Credentials", hint: "Shared logins, every read logged" },
                { href: "/planner", label: "Team updates", hint: "Everyone's plans and progress" },
                { href: "/work-hours", label: "Work hours", hint: "Attendance hours by person" },
              ].map((t) => (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    className="block rounded-xl px-3 py-2 ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:ring-indigo-300"
                  >
                    <span className="block text-sm font-semibold text-slate-800">{t.label} →</span>
                    <span className="block text-xs text-slate-500">{t.hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard title="Email">
            <EmailCheck />
          </SectionCard>
        </div>

        <SectionCard
          title="Recent activity"
          action={
            <Link href="/admin/activity" className="inline-block py-1 text-sm font-medium text-indigo-600 hover:underline">
              View all
            </Link>
          }
        >
          {org.recentActivity.length === 0 ? (
            <p className="text-sm text-slate-500">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {org.recentActivity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 text-slate-700">
                    <span className="font-medium">{a.user_name ?? "System"}</span>{" "}
                    <span className="text-slate-600">{humanizeAction(a.action).toLowerCase()}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">{formatRelative(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}

function DecisionsCard({ decisions: d }: { decisions: AdminOverview["decisions"] }) {
  const rows = [
    { label: "Project requests", value: d.projectRequests, href: "/reviews", hint: "New projects waiting for a lead or you" },
    { label: "Task requests", value: d.taskRequests, href: "/reviews", hint: "Work members asked for" },
    { label: "Finished tasks to approve", value: d.finishedTasks, href: "/reviews", hint: "Waiting for the project owner" },
    { label: "Finished subtasks to approve", value: d.finishedSubtasks, href: "/reviews?tab=overdue", hint: "Waiting for the task owner" },
    { label: "Blockers to confirm", value: d.blockers, href: "/reviews", hint: "Someone says they are stuck" },
    { label: "Tasks to sign off", value: d.signOffs, href: "/reviews?tab=overdue", hint: "Done, waiting for the requester" },
    { label: "Projects ready to close", value: d.readyToClose, href: "/projects", hint: "Every task signed off" },
  ];
  return (
    <SectionCard
      title="Needs a decision"
      action={
        <Link href="/reviews" className="inline-block py-1 text-sm font-medium text-indigo-600 hover:underline">
          Approvals
        </Link>
      }
    >
      <ul className="-my-1 divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.label}>
            <Link href={r.href} className="flex items-center gap-3 py-2 hover:text-indigo-700">
              <span
                className={`figure flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-bold ${
                  r.value > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-400"
                }`}
              >
                {r.value}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${r.value > 0 ? "text-slate-800" : "text-slate-500"}`}>{r.label}</span>
                <span className="block text-xs text-slate-500">{r.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function ReviewersCard({ reviewers }: { reviewers: AdminOverview["reviewers"] }) {
  return (
    <SectionCard title="Where reviews are waiting">
      {reviewers.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing is waiting for a review. ✅</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Finished work only counts once it is approved. The people below are holding it.
          </p>
          <ul className="space-y-2.5">
            {reviewers.map((r) => (
              <li key={r.reviewer_id ?? "none"} className="flex items-center gap-3">
                <Avatar name={r.name ?? "?"} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">
                    {r.name ?? "No reviewer — the project has no owner"}
                  </span>
                  {r.oldest && (
                    <span className="block text-xs text-slate-500">Oldest waiting since {formatRelative(r.oldest)}</span>
                  )}
                </span>
                <span className="figure rounded-full bg-amber-50 px-2.5 py-0.5 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">
                  {r.waiting}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

function WorkloadCard({ people, idle }: { people: AdminOverview["people"]; idle: AdminOverview["idle"] }) {
  const top = people.slice(0, 6);
  const most = Math.max(1, ...top.map((p) => p.open_items));
  return (
    <SectionCard
      title="Workload"
      action={
        <Link href="/team" className="inline-block py-1 text-sm font-medium text-indigo-600 hover:underline">
          Team
        </Link>
      }
    >
      {top.length === 0 ? (
        <p className="text-sm text-slate-500">Nobody has open work assigned.</p>
      ) : (
        <ul className="space-y-2.5">
          {top.map((p) => (
            <li key={p.id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium text-slate-800">
                  {p.name}
                  {p.department && <span className="ml-1.5 text-xs font-normal text-slate-500">{p.department}</span>}
                </span>
                <span className="figure shrink-0 text-xs text-slate-600">
                  {p.open_items} open
                  {p.overdue > 0 && <span className="ml-1 font-semibold text-red-600">· {p.overdue} overdue</span>}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${p.overdue > 0 ? "bg-gradient-to-r from-orange-400 to-red-500" : "bg-gradient-to-r from-sky-400 to-indigo-500"}`}
                  style={{ width: `${(p.open_items / most) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {idle.length > 0 && (
        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
          <p className="text-xs font-medium text-slate-700">
            {idle.length} {idle.length === 1 ? "person has" : "people have"} nothing open
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {idle.slice(0, 6).map((p) => p.name).join(", ")}
            {idle.length > 6 ? ` and ${idle.length - 6} more` : ""}
          </p>
        </div>
      )}
    </SectionCard>
  );
}

function PortfolioCard({ rows }: { rows: PortfolioRow[] }) {
  return (
    <SectionCard
      title="Portfolio health"
      action={
        <Link href="/reports?tab=progress" className="inline-block py-1 text-sm font-medium text-indigo-600 hover:underline">
          Progress report
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No active projects.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Every active project, the ones behind schedule first. Progress counts approved work only; the
            schedule compares it with how much of the project&apos;s time has gone.
          </p>
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_130px_minmax(0,1.3fr)_90px] gap-4 border-b border-slate-100 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
            <span>Project</span>
            <span>Progress (approved)</span>
            <span>Schedule</span>
            <span>Finish</span>
            <span className="text-right">Open issues</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {rows.map((p) => (
              <li
                key={p.id}
                className="grid grid-cols-1 gap-2 py-3 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_130px_minmax(0,1.3fr)_90px] lg:items-center lg:gap-4"
              >
                <div className="min-w-0">
                  <Link href={`/projects/${p.id}`} className="block truncate text-sm font-semibold text-slate-800 hover:text-indigo-600">
                    {p.name}
                  </Link>
                  <span className="block truncate text-xs text-slate-500">
                    {[p.department, p.owner_name ? `Owner ${p.owner_name}` : "No owner"].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <WorkProgress approved={p.percent} size="sm" label={`${p.name} progress`} className="flex-1" />
                  <span className="figure w-10 shrink-0 text-right text-sm font-semibold text-slate-800">{Math.round(p.percent)}%</span>
                </div>
                <div>
                  <HealthBadge approved={p.percent} start={p.start_date} due={p.due_date} />
                  {p.expected !== null && p.health !== "done" && p.health !== "not_started" && (
                    <span className="figure mt-0.5 block text-[11px] text-slate-500">expected {Math.round(p.expected)}%</span>
                  )}
                </div>
                <div className="text-xs text-slate-600">
                  {p.due_date ? <span className="block">Due {formatDate(p.due_date)}</span> : <span className="block text-slate-400">No due date</span>}
                  {p.eta && (
                    <span className={`block ${p.daysLate != null && p.daysLate > 0 ? "font-medium text-red-600" : "text-emerald-700"}`}>
                      Forecast {formatDate(p.eta)}
                      {p.daysLate != null && p.daysLate > 0 ? ` · ${p.daysLate}d late` : ""}
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5 text-xs lg:justify-end">
                  {p.overdue_count > 0 && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-red-200" title="Overdue tasks">
                      {p.overdue_count} overdue
                    </span>
                  )}
                  {p.review_count > 0 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200" title="Tasks in review">
                      {p.review_count} review
                    </span>
                  )}
                  {p.overdue_count === 0 && p.review_count === 0 && <span className="text-slate-400">—</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

function DataIssuesCard({ issues }: { issues: AdminOverview["dataIssues"] }) {
  const open = issues.filter((i) => i.count > 0);
  return (
    <SectionCard title="Records to fix">
      {open.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing to fix — every person has a department and every project an owner and a due date. ✅</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Gaps that make the reports wrong or leave work with nobody to approve it.
          </p>
          <ul className="space-y-2">
            {open.map((i) => (
              <li key={i.key}>
                <Link
                  href={i.href}
                  className="flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1 ring-rose-200 transition hover:bg-rose-50"
                >
                  <span className="figure flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg bg-rose-100 px-1.5 text-sm font-bold text-rose-700">
                    {i.count}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800">{i.label} →</span>
                    {i.examples.length > 0 && (
                      <span className="block truncate text-xs text-slate-500">
                        {i.examples.join(", ")}
                        {i.count > i.examples.length && i.key !== "odd-department" ? ", …" : ""}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}
