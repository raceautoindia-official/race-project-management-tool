import Link from "next/link";
import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import WorkHoursView from "@/components/WorkHoursView";
import TimeDayView from "@/components/work/TimeDayView";
import AutoRefresh from "@/components/work/AutoRefresh";
import { PageTabs } from "@/components/work/items";
import { getWorkHours } from "@/lib/work-hours-data";
import { getTimeDay } from "@/lib/time-data";
import { weekBounds } from "@/lib/work-hours";
import { istDateKey } from "@/lib/tz";

export const dynamic = "force-dynamic";

function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/**
 * Time at work (the Attendance clock) beside time on tasks (the work timer
 * and anything typed in by hand).
 *
 *   Day   who is working on what right now, and each person's day: clocked
 *         in, on tasks, no timer, the tasks and subtasks it went to.
 *   Week  hours at work against hours logged, day by day.
 *
 * Everyone sees themselves. A manager also sees the people who report to
 * them in the Attendance app (employees.manager_id); an admin sees everyone.
 */
export default async function WorkHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string; date?: string }>;
}) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const now = new Date();
  const today = istDateKey(now.toISOString().replace("T", " ").slice(0, 19));
  // Old links with ?week= open the week they point at.
  const view = sp.view === "week" || (sp.week && sp.view !== "day") ? "week" : "day";

  // employee_id links PM back to the Attendance app; it is set when someone
  // first signs in, so it is always present for a signed-in user.
  const [me] = await query<DbRow[]>(`SELECT employee_id FROM users WHERE id = ?`, [user.id]);
  const viewer = { id: user.id, employee_id: Number(me?.employee_id ?? 0), role: user.role };

  const tabs = (
    <PageTabs
      label="Time views"
      active={view}
      tabs={[
        { key: "day", label: "Day", href: "/work-hours" },
        { key: "week", label: "Week", href: "/work-hours?view=week" },
      ]}
    />
  );
  const offline = (
    <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      The Attendance app couldn’t be reached, so clocked-in hours are missing. Time on tasks is still
      shown.
    </p>
  );

  if (view === "week") {
    const { from, to } = weekBounds(/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? sp.week! : today);
    const report = await getWorkHours(viewer, from, to);
    return (
      <AppShell user={user}>
        <PageHeader
          title="Work hours"
          subtitle="Time at work, from the Attendance app, beside the time logged against tasks here."
        />
        {tabs}
        {report.attendanceUnavailable && offline}
        <WorkHoursView people={report.people} from={from} to={to} ownOnly={report.ownOnly} today={today} />
      </AppShell>
    );
  }

  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") && sp.date! <= today ? sp.date! : today;
  const isToday = day === today;
  const report = await getTimeDay(viewer, day, now);
  const nav = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50";

  return (
    <AppShell user={user}>
      <PageHeader
        title="Work hours"
        subtitle="Clocked-in time from the Attendance app, and the work timer's time on each task and subtask."
      />
      {tabs}
      {isToday && <AutoRefresh seconds={60} />}
      {report.attendanceUnavailable && offline}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/work-hours?date=${shiftDay(day, -1)}`} className={nav} aria-label="Previous day">
          ←
        </Link>
        <h2 className="text-base font-semibold text-slate-900">{isToday ? `Today · ${dayLabel(day)}` : dayLabel(day)}</h2>
        {!isToday && (
          <>
            <Link href={`/work-hours?date=${shiftDay(day, 1)}`} className={nav} aria-label="Next day">
              →
            </Link>
            <Link href="/work-hours" className={nav}>
              Today
            </Link>
          </>
        )}
      </div>
      <TimeDayView report={report} now={now.toISOString()} isToday={isToday} />
    </AppShell>
  );
}
