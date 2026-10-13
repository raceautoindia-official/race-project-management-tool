import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import WorkHoursView from "@/components/WorkHoursView";
import { getWorkHours } from "@/lib/work-hours-data";
import { weekBounds } from "@/lib/work-hours";
import { istDateKey } from "@/lib/tz";

export const dynamic = "force-dynamic";

/**
 * Hours at work beside hours logged against tasks — the two halves the
 * Attendance app and PM each hold on their own.
 *
 * Everyone sees their own week. A manager also sees the people who report to
 * them in the Attendance app (employees.manager_id); an admin sees everyone.
 */
export default async function WorkHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requirePageUser();
  const { week } = await searchParams;

  const today = istDateKey(new Date().toISOString().replace("T", " ").slice(0, 19));
  const { from, to } = weekBounds(/^\d{4}-\d{2}-\d{2}$/.test(week ?? "") ? week! : today);

  // employee_id links PM back to the Attendance app; it is set when someone
  // first signs in, so it is always present for a signed-in user.
  const [me] = await query<DbRow[]>(`SELECT employee_id FROM users WHERE id = ?`, [user.id]);

  const report = await getWorkHours(
    { id: user.id, employee_id: Number(me?.employee_id ?? 0), role: user.role },
    from,
    to
  );

  return (
    <AppShell user={user}>
      <PageHeader
        title="Work hours"
        subtitle="Time at work, from the Attendance app, beside the time logged against tasks here."
      />
      {report.attendanceUnavailable && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          The Attendance app couldn’t be reached, so hours at work are missing. Time logged
          against tasks is still shown.
        </p>
      )}
      <WorkHoursView
        people={report.people}
        from={from}
        to={to}
        ownOnly={report.ownOnly}
        today={today}
      />
    </AppShell>
  );
}
