import Link from "next/link";
import { requirePageAdmin } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import PeopleTable, { type PersonRow } from "@/components/admin/PeopleTable";
import JobLevels, { type LevelRow } from "@/components/admin/JobLevels";

export const dynamic = "force-dynamic";

/**
 * Admin › People & levels. Everyone's department and job title, and the
 * seniority level each job title carries.
 *
 * Departments follow the Attendance app unless an admin set one here; job
 * titles are free text kept in PM. A title is matched to its level by name.
 */
export default async function AdminPeoplePage() {
  const user = await requirePageAdmin();

  const people = await query<DbRow[]>(
    `SELECT u.id, u.emp_id, u.name, u.email, u.role, u.department, u.department_source,
            u.designation, dl.level
       FROM users u
       LEFT JOIN designation_levels dl ON dl.title = TRIM(u.designation)
      WHERE u.is_active = TRUE
      ORDER BY u.name`
  );

  // The list, plus any title people already hold that was never added to it
  // (titles set before levels existed) — those need a level too.
  const levelRows = await query<DbRow[]>(
    `SELECT d.id, d.title, d.level,
            (SELECT COUNT(*) FROM users u
              WHERE u.is_active = TRUE AND TRIM(u.designation) = d.title) AS people
       FROM designation_levels d
     UNION ALL
     SELECT NULL, TRIM(u.designation), NULL, COUNT(*)
       FROM users u
      WHERE u.is_active = TRUE AND TRIM(COALESCE(u.designation, '')) <> ''
        AND NOT EXISTS (SELECT 1 FROM designation_levels d WHERE d.title = TRIM(u.designation))
      GROUP BY TRIM(u.designation)`
  );

  const rows: PersonRow[] = people.map((p) => ({
    id: Number(p.id),
    empId: (p.emp_id as string | null) ?? null,
    name: String(p.name),
    email: (p.email as string | null) ?? null,
    role: p.role as PersonRow["role"],
    department: (p.department as string | null) ?? null,
    departmentSource: p.department_source === "pm" ? "pm" : "attendance",
    designation: (p.designation as string | null)?.trim() || null,
    level: p.level == null ? null : Number(p.level),
  }));

  const levels: LevelRow[] = levelRows
    .map((r) => ({
      id: r.id == null ? null : Number(r.id),
      title: String(r.title),
      level: r.level == null ? null : Number(r.level),
      people: Number(r.people),
    }))
    .sort(
      (a, b) =>
        Number(a.level === null) - Number(b.level === null) ||
        (a.level ?? 0) - (b.level ?? 0) ||
        a.title.localeCompare(b.title)
    );

  const needLevel = levels.filter((l) => l.level === null).length;

  return (
    <AppShell user={user}>
      <PageHeader
        title="People & levels"
        subtitle="Everyone's department and job title, and the seniority level each job title carries."
        figures={[
          { label: "People", value: rows.length },
          { label: "Job titles", value: levels.length },
          { label: "Need a level", value: needLevel },
        ]}
      />

      {needLevel > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <span>
            <strong className="figure">{needLevel}</strong> job{" "}
            {needLevel === 1 ? "title still needs" : "titles still need"} a level.
          </span>
          <Link href="#job-levels" className="font-medium text-amber-900 underline hover:no-underline">
            Set levels
          </Link>
        </div>
      )}

      <div className="space-y-8">
        <PeopleTable people={rows} />
        <JobLevels levels={levels} />
      </div>
    </AppShell>
  );
}
