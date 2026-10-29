import Link from "next/link";
import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import { getTeamPerformance, ontimePct, effortPct } from "@/lib/performance";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import { RoleBadge } from "@/components/Badge";
import Avatar from "@/components/Avatar";
import ExportButton from "@/components/ExportButton";
import { ProgressBar } from "@/components/ProgressBar";
import { formatHM } from "@/lib/tz";
import { formatRelative } from "@/lib/format";
import { DepartmentBadge } from "@/components/DepartmentField";
import EditPersonButton from "@/components/EditPersonButton";
import type { MemberStats } from "@/lib/performance";
import { dailyStatusGrid, submissionRate, trackingSince, type StatusCell } from "@/lib/work-updates";
import { describePeriod, isDateKey, isWorkDay, todayIst, updateStatus, weekStart } from "@/lib/planner";
import { PageTabs } from "@/components/work/items";
import RemindButton from "@/components/work/RemindButton";
import { UPDATE_STATUS, UpdateStatusBadge, UpdateStatusLegend } from "@/components/work/update-status";
import StaffSyncButton from "@/components/work/StaffSyncButton";
import { lastStaffSync, listRetired, type RetiredPerson, type StaffSyncResult } from "@/lib/staff-sync";
import { formatDate } from "@/lib/format";

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export const dynamic = "force-dynamic";

/** People under the department they belong to, biggest team first. */
function groupByDepartment(members: MemberStats[]): [string, MemberStats[]][] {
  const groups = new Map<string, MemberStats[]>();
  for (const m of members) {
    const key = m.department || "No department";
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === "No department") return 1;
    if (b[0] === "No department") return -1;
    return b[1].length - a[1].length || a[0].localeCompare(b[0]);
  });
}

const SUBTITLES = {
  all: "Individual status and 30-day performance for every member.",
  led: "Individual status and 30-day performance for members of the projects you lead.",
  shared: "The people you share projects with, and what they are working on.",
  self: "Your individual status and 30-day performance.",
} as const;

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string; view?: string }> }) {
  const user = await requirePageUser();
  const { scope, members } = await getTeamPerformance(user);
  const sp = await searchParams;
  // Admins see everyone's updates, leads their projects' people.
  const seesUpdates = scope === "all" || scope === "led";
  // People who have left are the admin's to see: retired, not deleted.
  const seesRetired = scope === "all";
  const retired = seesRetired ? await listRetired() : [];
  const tab =
    seesUpdates && sp.tab === "updates" ? "updates" : seesRetired && sp.tab === "retired" ? "retired" : "people";
  const today = todayIst();
  const gridEnd = sp.date && isDateKey(sp.date) && sp.date <= today ? sp.date : today;
  // Work updates come in two sizes: each day's, and each week's plan and summary.
  const view = sp.view === "week" ? "week" : "day";
  // Everyone who writes updates (not admins), and their last 30 days.
  const writers = members.filter((m) => m.role !== "admin");
  const grid = seesUpdates
    ? await dailyStatusGrid(writers.map((m) => m.id), shiftDay(today, -29), today, today)
    : new Map<number, StatusCell[]>();
  const opens = (id: number) => seesUpdates || id === user.id;
  // Exporting a spreadsheet of colleagues' performance stays with the people
  // accountable for it. Seeing who you work with is not the same thing.
  const showExport = scope === "all" || scope === "led";
  // Each job title's seniority level (Admin › People & levels), matched by name.
  const levelRows = await query<DbRow[]>(
    `SELECT title, level FROM designation_levels WHERE level IS NOT NULL`
  );
  const levelOf = new Map(levelRows.map((r) => [String(r.title).toLowerCase(), Number(r.level)]));
  const levelFor = (title: string) => levelOf.get(title.trim().toLowerCase());

  return (
    <AppShell user={user}>
      <PageHeader
        title="Team performance"
        subtitle={SUBTITLES[scope]}
        action={showExport ? <ExportButton href="/api/team/export" /> : undefined}
      />
      {seesUpdates && (
        <PageTabs
          label="Team views"
          active={tab}
          tabs={[
            { key: "people", label: "People", href: "/team" },
            { key: "updates", label: "Work updates", href: "/team?tab=updates" },
            ...(seesRetired
              ? [{ key: "retired", label: `Retired (${retired.length})`, href: "/team?tab=retired" }]
              : []),
          ]}
        />
      )}
      {tab === "retired" ? (
        <RetiredList people={retired} last={await lastStaffSync()} />
      ) : tab === "updates" ? (
        <div className="space-y-4">
          <UpdatesSwitch view={view} />
          {view === "week" ? (
            <WeeklyBoard
              people={writers}
              monday={weekStart(gridEnd)}
              today={today}
              entries={await weekEntries(writers.map((m) => m.id), weekStart(gridEnd))}
              since={await trackingSince()}
            />
          ) : (
            <UpdatesGrid
              people={writers}
              end={gridEnd}
              today={today}
              cells={await dailyStatusGrid(writers.map((m) => m.id), shiftDay(gridEnd, -13), gridEnd, today)}
            />
          )}
        </div>
      ) : (

      <div className="space-y-8">
        {groupByDepartment(members).map(([dept, people]) => (
          <section key={dept}>
            <h2 className="mb-3 flex items-baseline gap-2">
              <span className="text-lg font-semibold text-slate-900">{dept}</span>
              <span className="figure text-sm text-slate-600">{people.length}</span>
              <span className="text-sm text-slate-600">
                {people.length === 1 ? "person" : "people"}
              </span>
            </h2>
            <div className="space-y-4">
        {people.map((m) => {
          const otp = ontimePct(m);
          const eff = effortPct(m);
          return (
            <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-5">
              {/* Header row: identity + presence + working-on */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Avatar name={m.name} size="lg" />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                        m.online ? "bg-green-500" : "bg-slate-300"
                      }`}
                      title={m.online ? "Online" : "Offline"}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      {opens(m.id) ? (
                        <Link href={`/team/${m.id}`} className="font-semibold text-slate-900 hover:text-indigo-600 hover:underline">
                          {m.name}
                        </Link>
                      ) : (
                        <span className="font-semibold text-slate-900">{m.name}</span>
                      )}
                      <RoleBadge role={m.role} />
                      <DepartmentBadge name={m.department} />
                      {user.role === "admin" && (
                        <EditPersonButton
                          userId={m.id}
                          name={m.name}
                          department={m.department}
                          departmentSource={m.department_source}
                          designation={m.designation}
                        />
                      )}
                    </div>
                    {m.designation && (
                      <div className="text-sm text-slate-700">
                        {m.designation}
                        {levelFor(m.designation) !== undefined && (
                          <span className="figure text-slate-500" title="Seniority level">
                            {" "}· L{levelFor(m.designation)}
                          </span>
                        )}
                      </div>
                    )}
                    {grid.has(m.id) && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span>Today&apos;s update:</span>
                        <UpdateStatusBadge status={grid.get(m.id)!.at(-1)!.status} />
                        {submissionRate(grid.get(m.id)!) !== null && (
                          <span className="figure" title="Share of the last 30 days' updates they submitted themselves">
                            {submissionRate(grid.get(m.id)!)}% submitted (30d)
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-xs text-slate-500">
                      {m.emp_id} ·{" "}
                      {m.online
                        ? "Active now"
                        : m.last_seen_at
                          ? `Last seen ${formatRelative(m.last_seen_at)}`
                          : "Never signed in"}
                    </div>
                  </div>
                </div>
                <div className="min-w-0 max-w-md text-right">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Working on now
                  </div>
                  {m.working_on.length === 0 ? (
                    <div className="text-sm text-slate-500">
                      {m.in_review > 0 ? "Awaiting review" : "Nothing in progress"}
                    </div>
                  ) : (
                    m.working_on.map((w) => (
                      <Link
                        key={w.id}
                        href={`/projects/${w.project_id}`}
                        className="block truncate py-1 text-sm text-indigo-600 hover:underline"
                      >
                        {w.title}
                        <span className="text-slate-500"> · {w.project_name}</span>
                      </Link>
                    ))
                  )}
                </div>
              </div>

              {/* Stats row */}
              <div className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4 lg:grid-cols-7">
                <Stat label="Open" value={m.open_tasks} />
                <Stat label="In progress" value={m.in_progress} />
                <Stat label="In review" value={m.in_review} tone={m.in_review ? "amber" : undefined} />
                <Stat label="Overdue" value={m.overdue_now} tone={m.overdue_now ? "red" : undefined} />
                <Stat label="Done (30d)" value={m.completed_30d} tone="green" />
                <Stat
                  label="On-time"
                  value={otp === null ? "—" : `${otp}%`}
                  tone={otp !== null && otp < 60 ? "red" : otp !== null ? "green" : undefined}
                  hint={
                    otp === null
                      ? "no due-dated completions"
                      : `${m.ontime_30d}/${m.due_completed_30d} on time`
                  }
                />
                <Stat label="Logged (30d)" value={formatHM(m.minutes_30d / 60)} />
              </div>

              {/* On-time + effort bars */}
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-slate-600">
                    <span>On-time completion (30d)</span>
                    <span>{otp === null ? "n/a" : `${otp}%`}</span>
                  </div>
                  <ProgressBar value={otp ?? 0} tone={(otp ?? 0) >= 60 ? "green" : "indigo"} />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-slate-600">
                    <span>Effort vs estimate (completed work)</span>
                    <span>
                      {eff === null
                        ? "n/a"
                        : `${eff}%${eff > 100 ? " (over)" : eff < 100 ? " (under)" : ""}`}
                    </span>
                  </div>
                  <ProgressBar value={Math.min(eff ?? 0, 100)} tone={eff !== null && eff > 100 ? "green" : "indigo"} />
                </div>
              </div>
            </div>
          );
        })}
            </div>
          </section>
        ))}
        {members.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">
            No members in scope.
          </div>
        )}
      </div>
      )}
    </AppShell>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "red" | "green" | "amber";
  hint?: string;
}) {
  const ink =
    tone === "red"
      ? "text-red-600"
      : tone === "green"
        ? "text-green-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-slate-900";
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2" title={hint}>
      <div className={`text-lg font-bold ${ink}`}>{value}</div>
      <div className="text-[11px] text-slate-600">{label}</div>
    </div>
  );
}

/**
 * People who are no longer in Attendance (or are switched off there). They
 * keep their history; what is still in their name is shown so it can be
 * handed to someone else.
 */
function RetiredList({ people, last }: { people: RetiredPerson[]; last: StaffSyncResult | null }) {
  const holding = people.filter((p) => p.open_tasks + p.owned_projects + p.led_projects > 0).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="mr-auto max-w-2xl">
          <p className="text-sm font-semibold text-slate-800">
            People who have left: removed or switched off in Attendance
          </p>
          <p className="text-xs text-slate-500">
            They can no longer sign in and are left off every list of current staff, pickers and reminders.
            Their tasks, comments and history stay. Reactivating someone in Attendance brings them back.
            {last && <> Last checked {formatRelative(last.at)}.</>}
          </p>
        </div>
        <StaffSyncButton label="Check against Attendance now" />
      </div>

      {last?.held && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-900 ring-1 ring-rose-200">
          <span className="mr-auto">{last.held}</span>
          {last.held.startsWith("Attendance would retire") && (
            <StaffSyncButton force label="It's right — retire them" />
          )}
        </div>
      )}

      {holding > 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
          {holding} {holding === 1 ? "person who has left still has" : "people who have left still have"} open
          work in their name. Open them to hand it to someone else.
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Person</th>
              <th className="px-4 py-2.5">Left</th>
              <th className="px-4 py-2.5">Last signed in</th>
              <th className="px-4 py-2.5">Still in their name</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.map((p) => {
              const owes = [
                p.open_tasks && `${p.open_tasks} open ${p.open_tasks === 1 ? "task" : "tasks"}`,
                p.owned_projects && `owns ${p.owned_projects} ${p.owned_projects === 1 ? "project" : "projects"}`,
                p.led_projects && `leads ${p.led_projects} ${p.led_projects === 1 ? "project" : "projects"}`,
              ].filter(Boolean);
              return (
                <tr key={p.id} className="align-top">
                  <td className="px-4 py-3">
                    <Link href={`/team/${p.id}?tab=work`} className="font-medium text-slate-800 hover:text-indigo-600 hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {[p.emp_id, p.department, p.designation].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {p.retired_at ? formatDate(p.retired_at) : "—"}
                    <div className="text-xs text-slate-500">
                      {p.retired_reason === "removed"
                        ? "Removed from Attendance"
                        : p.retired_reason === "deactivated"
                          ? "Switched off in Attendance"
                          : "Inactive"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.last_seen_at ? formatRelative(p.last_seen_at) : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    {owes.length ? (
                      <span className="text-amber-800">{owes.join(" · ")}</span>
                    ) : (
                      <span className="text-slate-500">Nothing open</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {people.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Nobody has left.</p>}
      </div>
    </div>
  );
}

/** Daily or weekly work updates. */
function UpdatesSwitch({ view }: { view: "day" | "week" }) {
  const item = (key: "day" | "week", label: string, hint: string) => (
    <Link
      href={key === "week" ? "/team?tab=updates&view=week" : "/team?tab=updates"}
      aria-current={view === key ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-left transition ${
        view === key ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"
      }`}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span className="block text-xs text-slate-500">{hint}</span>
    </Link>
  );
  return (
    <nav aria-label="Which updates" className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {item("day", "Daily", "Each day's plan, how it went, and the day's summary")}
      {item("week", "Weekly", "Each week's plan and weekly summary")}
    </nav>
  );
}

interface WeekEntry {
  user_id: number;
  plan: string | null;
  progress: string | null;
  submitted_at: string | null;
  submission: "manual" | "auto" | null;
}

/** Everyone's weekly entry for one week, by person. */
async function weekEntries(userIds: number[], monday: string): Promise<Map<number, WeekEntry>> {
  if (!userIds.length) return new Map();
  const rows = await query<DbRow[]>(
    `SELECT user_id, plan, progress, submitted_at, submission FROM planner_entries
      WHERE period = 'week' AND entry_date = ? AND user_id IN (${userIds.map(() => "?").join(", ")})`,
    [monday, ...userIds]
  );
  return new Map(rows.map((r) => [Number(r.user_id), r as unknown as WeekEntry]));
}

function WeekText({ value, empty }: { value: string | null | undefined; empty: string }) {
  return value ? (
    <p className="line-clamp-4 whitespace-pre-line text-sm text-slate-800">{value}</p>
  ) : (
    <p className="text-sm italic text-slate-400">{empty}</p>
  );
}

/**
 * Everyone's weekly plan and weekly summary for one week, side by side. A
 * name opens that person's week, next to the week as the app recorded it.
 */
function WeeklyBoard({
  people,
  monday,
  today,
  entries,
  since,
}: {
  people: MemberStats[];
  monday: string;
  today: string;
  entries: Map<number, WeekEntry>;
  since: string | null;
}) {
  const thisWeek = weekStart(today);
  const over = monday < thisWeek;
  const planned = people.filter((p) => entries.get(p.id)?.plan).length;
  const summed = people.filter((p) => entries.get(p.id)?.progress).length;
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="mr-auto">
          <p className="text-sm font-semibold text-slate-800">Week of {describePeriod("week", monday)}</p>
          <p className="text-xs text-slate-500">
            <span className="figure">{planned}</span> of <span className="figure">{people.length}</span> wrote a plan ·{" "}
            <span className="figure">{summed}</span> wrote a summary. Weekly updates lock at midnight on Saturday.
          </p>
        </div>
        <Link href={`/team?tab=updates&view=week&date=${shiftDay(monday, -7)}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          ← Earlier
        </Link>
        {over && (
          <Link href={`/team?tab=updates&view=week&date=${shiftDay(monday, 7)}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Later →
          </Link>
        )}
        <a
          href={`/api/planner/export?scope=team&period=week&date=${monday}`}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-sky-800 ring-1 ring-sky-300 hover:bg-sky-50"
        >
          ⤓ Download everyone&rsquo;s
        </a>
        {!over && dow >= 1 && <RemindButton kind="week_plan" date={monday} label="Remind: weekly plan" />}
        {!over && dow === 6 && <RemindButton kind="week_summary" date={monday} label="Remind: weekly summary" />}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-56 px-4 py-2.5">Person</th>
              <th className="px-4 py-2.5">Weekly plan</th>
              <th className="px-4 py-2.5">Weekly summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.map((p) => {
              const e = entries.get(p.id);
              return (
                <tr key={p.id} className="align-top">
                  <td className="px-4 py-3">
                    <Link href={`/team/${p.id}?tab=updates&date=${monday}`} className="font-medium text-slate-800 hover:text-indigo-600 hover:underline">
                      {p.name}
                    </Link>
                    {p.department && <div className="text-xs text-slate-500">{p.department}</div>}
                    <div className="mt-1.5">
                      <UpdateStatusBadge status={updateStatus("week", monday, today, e, since)} period="week" />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <WeekText value={e?.plan} empty={over ? "No plan was written" : "No plan yet"} />
                  </td>
                  <td className="px-4 py-3">
                    <WeekText value={e?.progress} empty={over ? "No summary was written" : "Not written yet — due Saturday"} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {people.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Nobody here writes updates.</p>}
      </div>
    </div>
  );
}

/**
 * Everyone × the last two weeks of daily updates: who submitted, who left it
 * to the app, who is still due today. A cell opens that person's day.
 */
function UpdatesGrid({
  people,
  end,
  today,
  cells,
}: {
  people: MemberStats[];
  end: string;
  today: string;
  cells: Map<number, StatusCell[]>;
}) {
  const days: string[] = [];
  for (let d = shiftDay(end, -13); d <= end; d = shiftDay(d, 1)) days.push(d);
  const dueToday = people.filter((p) => {
    const c = cells.get(p.id)?.find((x) => x.date === today);
    return c && (c.status === "due" || c.status === "draft");
  }).length;
  const label = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "narrow", timeZone: "UTC" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="mr-auto">
          <p className="text-sm font-semibold text-slate-800">
            {describePeriod("day", shiftDay(end, -13))} – {describePeriod("day", end)}
          </p>
          <p className="text-xs text-slate-500">
            Updates are due Monday to Saturday and lock at midnight; anything not submitted is submitted by the app.
          </p>
        </div>
        <Link href={`/team?tab=updates&date=${shiftDay(end, -14)}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          ← Earlier
        </Link>
        {end < today && (
          <Link href={`/team?tab=updates&date=${shiftDay(end, 14) > today ? today : shiftDay(end, 14)}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Later →
          </Link>
        )}
        <a
          href={`/api/planner/export?scope=team&period=day&date=${end}`}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-sky-800 ring-1 ring-sky-300 hover:bg-sky-50"
        >
          ⤓ Download everyone&rsquo;s
        </a>
        {isWorkDay(today) && dueToday > 0 && (
          <RemindButton kind="day" date={today} label={`Remind the ${dueToday} not submitted today`} />
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Person</th>
              {days.map((d) => (
                <th key={d} className={`w-8 text-center text-[11px] font-medium ${d === today ? "text-indigo-700" : "text-slate-500"}`} title={d}>
                  {label(d)}
                  <span className="block text-[10px] font-normal">{Number(d.slice(8))}</span>
                </th>
              ))}
              <th className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">30d</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const row = cells.get(p.id) ?? [];
              return (
                <tr key={p.id}>
                  <td className="max-w-[12rem] truncate pr-2">
                    <Link href={`/team/${p.id}?tab=updates`} className="font-medium text-slate-800 hover:text-indigo-600">
                      {p.name}
                    </Link>
                    {p.department && <span className="ml-1.5 text-xs text-slate-500">{p.department}</span>}
                  </td>
                  {row.map((c) => (
                    <td key={c.date}>
                      <Link
                        href={`/team/${p.id}?tab=updates&date=${c.date}`}
                        title={`${p.name} · ${c.date}: ${UPDATE_STATUS[c.status].label}${c.reminded ? ` · reminded ${c.reminded}×` : ""}`}
                        className={`relative block h-7 rounded-md ${UPDATE_STATUS[c.status].cell}`}
                      >
                        <span className="sr-only">{c.date}: {UPDATE_STATUS[c.status].label}</span>
                        {c.reminded > 0 && (
                          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-1 ring-white" aria-hidden />
                        )}
                      </Link>
                    </td>
                  ))}
                  <td className="figure text-right text-xs text-slate-600">
                    {(() => {
                      const r = submissionRate(row);
                      return r === null ? "—" : `${r}%`;
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {people.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nobody here writes updates.</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <UpdateStatusLegend />
          <span className="text-xs text-slate-500">
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" aria-hidden /> reminded
          </span>
        </div>
      </div>
    </div>
  );
}
