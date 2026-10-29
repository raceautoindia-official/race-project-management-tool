import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/lib/page-guard";
import { canReadPlanner } from "@/lib/planner-data";
import { getPersonProfile, type PersonProfile } from "@/lib/person-profile";
import { describePeriod, isDateKey, todayIst } from "@/lib/planner";
import { ontimePct, effortPct } from "@/lib/performance";
import { formatMinutes, upcomingLine, weekLine } from "@/lib/planner-summary-shape";
import AppShell from "@/components/AppShell";
import { PageHeader, SectionCard } from "@/components/Cards";
import Avatar from "@/components/Avatar";
import { RoleBadge } from "@/components/Badge";
import { DepartmentBadge } from "@/components/DepartmentField";
import DailySummaryPanel from "@/components/DailySummary";
import RemindButton from "@/components/work/RemindButton";
import { UPDATE_STATUS, UpdateStatusBadge, UpdateStatusLegend } from "@/components/work/update-status";
import { PageTabs, itemHref } from "@/components/work/items";
import type { WorkItem } from "@/lib/my-work";
import { formatHM, formatIst } from "@/lib/tz";
import { formatDate, formatRelative, humanizeAction } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Team › a person — everything an admin (or the lead of a project they are
 * on) needs to know about someone: who they are and how they are doing, the
 * work on them and the work waiting on them, their daily and weekly updates
 * with what the board recorded, and what they did lately.
 */

/** One line per point, list markers dropped (PointsInput's rule, here on the server). */
function pointsOf(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•‣▪]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

const TABS = ["overview", "work", "updates", "activity"] as const;
type Tab = (typeof TABS)[number];

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; date?: string }>;
}) {
  const user = await requirePageUser();
  const personId = Number((await params).id);
  if (!Number.isInteger(personId) || personId <= 0) notFound();
  if (!(await canReadPlanner(user, personId))) redirect("/team");

  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const today = todayIst();
  const date = sp.date && isDateKey(sp.date) && sp.date <= today ? sp.date : today;
  const profile = await getPersonProfile(user, personId, date, today);
  if (!profile) notFound();
  const { person, stats } = profile;
  const base = `/team/${personId}`;
  const canRemind = personId !== user.id && person.role !== "admin" && Boolean(person.is_active);

  return (
    <AppShell user={user}>
      <div className="mb-2 text-sm">
        <Link href={person.is_active ? "/team" : "/team?tab=retired"} className="inline-block py-1 text-slate-600 hover:text-indigo-600">
          ← {person.is_active ? "Team" : "Retired"}
        </Link>
      </div>
      <PageHeader
        title={String(person.name)}
        subtitle={[person.designation, person.department, person.emp_id].filter(Boolean).join(" · ")}
        figures={[
          { label: "Open work", value: profile.work.todo.length },
          { label: "Overdue", value: stats?.overdue_now ?? 0 },
          { label: "Waiting on them", value: profile.work.reviewSubtasks.length + profile.work.reviewTasks.length },
          { label: "Updates submitted (30d)", value: profile.rate === null ? "—" : `${profile.rate}%` },
        ]}
      />
      {!person.is_active && (
        <p role="status" className="mb-4 rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-700 ring-1 ring-slate-200">
          <strong>Retired</strong>
          {person.retired_at ? ` on ${formatDate(person.retired_at)}` : ""} —{" "}
          {person.retired_reason === "deactivated" ? "switched off in Attendance" : "no longer in Attendance"}.
          They can&apos;t sign in and aren&apos;t offered for new work; anything still in their name is under Work.
        </p>
      )}
      <PageTabs
        label="About this person"
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: base },
          { key: "work", label: "Work", href: `${base}?tab=work`, count: profile.work.todo.length },
          { key: "updates", label: "Work updates", href: `${base}?tab=updates` },
          { key: "activity", label: "Activity", href: `${base}?tab=activity` },
        ]}
      />
      {tab === "overview" && <Overview profile={profile} base={base} />}
      {tab === "work" && <WorkTab profile={profile} />}
      {tab === "updates" && <UpdatesTab profile={profile} base={base} today={today} canRemind={canRemind} />}
      {tab === "activity" && <ActivityTab profile={profile} />}
    </AppShell>
  );
}

function Overview({ profile, base }: { profile: PersonProfile; base: string }) {
  const { person, stats, hours } = profile;
  const otp = stats ? ontimePct(stats) : null;
  const eff = stats ? effortPct(stats) : null;
  const last7 = profile.days.slice(-7);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <SectionCard title="Who they are">
        <div className="flex items-center gap-3">
          <Avatar name={String(person.name)} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900">{person.name}</span>
              <RoleBadge role={person.role} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <DepartmentBadge name={person.department} />
              {person.designation && <span>{person.designation}</span>}
            </div>
          </div>
        </div>
        <dl className="mt-4 space-y-1.5 text-sm">
          <Row label="Employee ID" value={person.emp_id} />
          <Row label="Email" value={person.email || "—"} />
          <Row
            label="Last seen"
            value={stats?.online ? "Active now" : person.last_seen_at ? formatRelative(person.last_seen_at) : "Never signed in"}
          />
          <Row label="Status" value={person.is_active ? "Active" : `Retired${person.retired_at ? ` ${formatDate(person.retired_at)}` : ""}`} />
        </dl>
      </SectionCard>

      <SectionCard title="Last 30 days">
        <div className="grid grid-cols-2 gap-3">
          <Figure label="Finished" value={stats?.completed_30d ?? 0} />
          <Figure label="On time" value={otp === null ? "—" : `${otp}%`} hint={stats ? `${stats.ontime_30d}/${stats.due_completed_30d} with a due date` : undefined} />
          <Figure label="Time logged" value={formatHM((stats?.minutes_30d ?? 0) / 60)} />
          <Figure label="Effort vs estimate" value={eff === null ? "—" : `${eff}%`} />
        </div>
        {hours && (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
            This week at work (Attendance): <strong>{formatMinutes(hours.presentMinutes)}</strong> over {hours.daysPresent}{" "}
            {hours.daysPresent === 1 ? "day" : "days"}; logged on tasks: <strong>{formatMinutes(hours.loggedMinutes)}</strong>
            {hours.coverage !== null && ` (${Math.round(hours.coverage * 100)}%)`}.
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Updates this week"
        action={
          <Link href={`${base}?tab=updates`} className="inline-block py-1 text-sm font-medium text-indigo-600 hover:underline">
            Read them
          </Link>
        }
      >
        <ul className="grid grid-cols-7 gap-1.5">
          {last7.map((c) => (
            <li key={c.date} className="text-center">
              <Link href={`${base}?tab=updates&date=${c.date}`} title={`${c.date}: ${UPDATE_STATUS[c.status].label}`}>
                <span className={`mx-auto block h-7 w-full rounded-md ${UPDATE_STATUS[c.status].cell}`} />
                <span className="mt-1 block text-[10px] text-slate-500">
                  {new Date(`${c.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-600">
          {profile.rate === null
            ? "No working days to count yet."
            : `${profile.rate}% of the last 30 days' updates were submitted by them; the rest were submitted automatically or are missing.`}
        </p>
      </SectionCard>

      <SectionCard title="Projects" className="lg:col-span-3">
        {profile.projects.length === 0 ? (
          <p className="text-sm text-slate-500">Not on any project.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {profile.projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="block rounded-xl px-3 py-2 ring-1 ring-slate-200 hover:bg-indigo-50 hover:ring-indigo-300">
                  <span className="block truncate text-sm font-semibold text-slate-800">{p.name}</span>
                  <span className="block text-xs text-slate-500">
                    {Number(p.is_owner) ? "Owner" : p.role_in_project === "lead" ? "Lead" : "Member"}
                    {" · "}
                    {p.status === "active" ? (p.approval_status === "approved" ? "Active" : "Awaiting approval") : p.status}
                    {Number(p.open_tasks) > 0 && ` · owns ${p.open_tasks} open task${Number(p.open_tasks) === 1 ? "" : "s"}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function WorkTab({ profile }: { profile: PersonProfile }) {
  const w = profile.work;
  const reviews = [...w.reviewSubtasks, ...w.reviewTasks];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <SectionCard title={`On them · ${w.todo.length}`}>
        <ItemList items={w.todo} empty="Nothing open." showDue />
      </SectionCard>
      <SectionCard title={`Waiting for their review · ${reviews.length}`}>
        <ItemList items={reviews} empty="Nothing waiting on them." who="from" />
      </SectionCard>
      <SectionCard title={`Sent for review · ${w.submitted.length}`}>
        <ItemList items={w.submitted} empty="Nothing waiting on others." who="with" />
      </SectionCard>
      <SectionCard title={`Tasks they own · ${w.ownedTasks.length}`}>
        {w.ownedTasks.length === 0 ? (
          <p className="text-sm text-slate-500">They own no open tasks.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {w.ownedTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/projects/${t.project_id}/tasks/${t.id}`} className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-600">{t.title}</span>
                  <span className="block truncate text-xs text-slate-500">{t.project_name}</span>
                </Link>
                <span className="figure shrink-0 text-xs text-slate-600">
                  {t.subtask_done}/{t.subtask_total} approved
                  {t.waiting_for_me > 0 && <span className="ml-1 font-medium text-amber-700">· {t.waiting_for_me} to review</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function ItemList({ items, empty, showDue = false, who }: { items: WorkItem[]; empty: string; showDue?: boolean; who?: "from" | "with" }) {
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.slice(0, 25).map((i) => {
        const overdue = Boolean(i.due_date && String(i.due_date).slice(0, 10) < todayIst());
        return (
          <li key={`${i.kind}-${i.id}`} className="flex items-center justify-between gap-3 py-2">
            <Link href={itemHref(i)} className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-600">{i.title}</span>
              <span className="block truncate text-xs text-slate-500">
                {i.kind === "subtask" ? `${i.task_title} · ` : ""}
                {i.project_name}
                {who === "from" && i.person_name ? ` · from ${i.person_name}` : ""}
                {who === "with" && i.kind === "task" && i.project_owner_name ? ` · with ${i.project_owner_name}` : ""}
              </span>
            </Link>
            {showDue && (
              <span className={`shrink-0 text-xs ${overdue ? "font-semibold text-red-600" : "text-slate-500"}`}>
                {i.due_date ? `${overdue ? "Overdue · " : "Due "}${formatDate(i.due_date)}` : "No due date"}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function UpdatesTab({
  profile,
  base,
  today,
  canRemind,
}: {
  profile: PersonProfile;
  base: string;
  today: string;
  canRemind: boolean;
}) {
  const { day, week } = profile;
  const personId = Number(profile.person.id);
  return (
    <div className="space-y-6">
      <SectionCard title="The last 30 days">
        <ul className="grid grid-cols-10 gap-1.5 sm:grid-cols-15" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(1.75rem, 1fr))" }}>
          {profile.days.map((c) => (
            <li key={c.date}>
              <Link
                href={`${base}?tab=updates&date=${c.date}`}
                title={`${c.date}: ${UPDATE_STATUS[c.status].label}${c.reminded ? ` · reminded ${c.reminded}×` : ""}`}
                className={`block h-8 rounded-md ${UPDATE_STATUS[c.status].cell} ${c.date === day.date ? "outline outline-2 outline-offset-2 outline-indigo-500" : ""}`}
              >
                <span className="sr-only">
                  {c.date}: {UPDATE_STATUS[c.status].label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <UpdateStatusLegend />
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title={`Daily update — ${describePeriod("day", day.date)}`}
          action={<UpdateStatusBadge status={day.status} />}
        >
          <EntryBody entry={day.entry} planLabel="What they meant to do" />
          {canRemind && (day.status === "due" || day.status === "draft") && (
            <div className="mt-4">
              <RemindButton kind="day" date={day.date} userIds={[personId]} label="Remind them to submit today's update" />
            </div>
          )}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Daily summary — recorded by the app
            </p>
            <DailySummaryPanel summary={day.recorded} />
          </div>
        </SectionCard>

        <SectionCard
          title={`Week of ${describePeriod("week", week.start)}`}
          action={<UpdateStatusBadge status={week.status} period="week" />}
        >
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly plan</p>
              {pointsOf(week.entry?.plan).length ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                  {pointsOf(week.entry?.plan).map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-slate-500">No plan written.</p>
              )}
              {upcomingLine(week.recorded.upcoming) && (
                <p className="mt-1 text-xs text-slate-500">On the board for the week: {upcomingLine(week.recorded.upcoming)}</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly summary</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{week.entry?.progress || "Not written yet."}</p>
              <p className="mt-1 text-xs text-slate-500">
                Recorded by the app: {weekLine(week.recorded) || "nothing logged this week yet"}.
              </p>
            </div>
            {week.entry?.submission && (
              <p className="text-xs text-slate-500">
                {week.entry.submission === "auto"
                  ? "Submitted automatically at the end of the week."
                  : `Submitted ${week.entry.submitted_at ? formatIst(String(week.entry.submitted_at)) : ""}.`}
              </p>
            )}
            {canRemind && !week.locked && (
              <div className="flex flex-wrap gap-2">
                {!week.entry?.plan && <RemindButton kind="week_plan" date={week.start} userIds={[personId]} label="Remind: weekly plan" />}
                {!week.entry?.progress && <RemindButton kind="week_summary" date={week.start} userIds={[personId]} label="Remind: weekly summary" />}
              </div>
            )}
          </div>
        </SectionCard>
      </div>
      {day.date !== today && (
        <p className="text-xs text-slate-500">
          <Link href={`${base}?tab=updates`} className="font-medium text-indigo-600 hover:underline">
            Back to today
          </Link>
        </p>
      )}
    </div>
  );
}

function EntryBody({ entry, planLabel }: { entry: PersonProfile["day"]["entry"]; planLabel: string }) {
  if (!entry) return <p className="text-sm text-slate-500">Nothing written.</p>;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{planLabel}</p>
        {pointsOf(entry.plan).length ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            {pointsOf(entry.plan).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-slate-500">—</p>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">How it went</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{entry.progress || "—"}</p>
      </div>
      <p className="text-xs text-slate-500">
        {entry.submission === "manual"
          ? `Submitted ${entry.submitted_at ? formatIst(String(entry.submitted_at)) : ""}`
          : entry.submission === "auto"
            ? "Submitted automatically at the end of the day — “how it went” may be what the app recorded."
            : "Saved as a draft, not submitted."}
      </p>
    </div>
  );
}

function ActivityTab({ profile }: { profile: PersonProfile }) {
  return (
    <SectionCard title="Recent activity">
      {profile.activity.length === 0 ? (
        <p className="text-sm text-slate-500">No activity recorded.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {profile.activity.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-slate-700">{humanizeAction(a.action)}</span>
              <span className="shrink-0 text-xs text-slate-500">{formatRelative(a.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-slate-800">{value}</dd>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200" title={hint}>
      <div className="figure text-xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
    </div>
  );
}

