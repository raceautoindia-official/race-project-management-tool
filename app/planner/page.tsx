import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import PlannerView, { type PlannerEntry } from "@/components/PlannerView";
import { entryDateFor, isDateKey, todayIst, type PlannerPeriod } from "@/lib/planner";
import { plannerForPeriod } from "@/lib/planner-data";

export const dynamic = "force-dynamic";

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const period: PlannerPeriod = params.period === "week" ? "week" : "day";
  const asked = params.date ?? "";
  const date = isDateKey(asked) ? asked : todayIst();
  const entryDate = entryDateFor(period, date);

  const [mine] = await query<DbRow[]>(
    `SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, period, plan, progress, updated_at
       FROM planner_entries
      WHERE user_id = ? AND period = ? AND entry_date = ? LIMIT 1`,
    [user.id, period, entryDate]
  );

  // A lead sees the people on the projects they lead; an admin sees everyone.
  const team = await plannerForPeriod(user, period, entryDate);
  const canSeeOthers =
    user.role === "admin" ||
    (
      await query<DbRow[]>(
        `SELECT 1 FROM project_members
          WHERE user_id = ? AND role_in_project = 'lead' LIMIT 1`,
        [user.id]
      )
    ).length > 0;

  return (
    <AppShell user={user}>
      <PageHeader
        title="Planner"
        subtitle={
          canSeeOthers
            ? "What you mean to do, and how it went — yours, and your team's."
            : "What you mean to do, and how it went. Your lead and an admin can read it."
        }
      />
      <PlannerView
        initialPeriod={period}
        initialDate={date}
        initialEntry={(mine as unknown as PlannerEntry) ?? null}
        initialTeam={team as unknown as PlannerEntry[]}
        canSeeOthers={canSeeOthers}
        currentUserId={user.id}
      />
    </AppShell>
  );
}
