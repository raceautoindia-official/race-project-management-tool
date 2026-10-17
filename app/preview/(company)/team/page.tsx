"use client";

// Team: everyone grouped by department, with a quick read on how busy each
// person is. People will come from the attendance system once the backend is
// connected; in the preview they are sample data.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { endOfMonth, format, parseISO, startOfMonth, subDays } from "date-fns";
import Avatar from "@/components/Avatar";
import { usePreview } from "@/lib/preview/store";
import {
  hrs,
  isOverdue,
  itemLink,
  pct,
  personHours,
  projectById,
  reviewQueue,
  todayISO,
  weekOf,
} from "@/lib/preview/engine";
import type { Person, PreviewState, WorkItem } from "@/lib/preview/types";
import {
  Button,
  Card,
  DeptBadge,
  Drawer,
  DueLabel,
  EmptyState,
  NotConnectedTag,
  PageHeader,
  SectionTitle,
  StatusPill,
  inputCls,
  useNotConnected,
} from "@/components/preview/ui";

const isOpen = (i: WorkItem) => i.status !== "done" && i.status !== "cancelled";

interface Workload {
  subtasks: WorkItem[]; // open subtasks assigned to them
  tasks: WorkItem[]; // open tasks they own
  projects: string[]; // project ids they own (not closed)
  reviews: WorkItem[];
  overdue: number;
  open: number;
}

// ── Man-hours ──────────────────────────────────────────────────────────────

// Same validated blue as Reports; the two status steps come from the data-viz
// status palette and always ship with an icon + label, never colour alone.
const BAR = "#2a78d6";
const WARN = "#fab219";
const CRIT = "#d03b3b";

type PeriodKey = "this_week" | "last_week" | "this_month";
interface Period { key: PeriodKey; label: string; from: string; to: string }

function periodOf(key: PeriodKey): Period {
  const today = todayISO();
  if (key === "this_month") {
    const d = parseISO(today);
    return { key, label: "This month", from: format(startOfMonth(d), "yyyy-MM-dd"), to: format(endOfMonth(d), "yyyy-MM-dd") };
  }
  const base = key === "last_week" ? format(subDays(parseISO(today), 7), "yyyy-MM-dd") : today;
  const w = weekOf(base);
  return { key, label: key === "last_week" ? "Last week" : "This week", from: w.start, to: w.end };
}

interface Hours {
  logged: number;
  capacity: number;
  utilisation: number;
  /** Planned hours still ahead on their open leaf items, net of what they've logged. */
  bookedAhead: number;
}

function isLeaf(s: PreviewState, i: WorkItem): boolean {
  return !!i.parentId || !s.items.some((x) => x.parentId === i.id);
}

function bookedAheadOf(s: PreviewState, personId: string): number {
  return s.items
    .filter((i) => i.personId === personId && isOpen(i) && isLeaf(s, i) && i.estimatedHours)
    .reduce((sum, i) => {
      const done = s.timeLogs.filter((l) => l.itemId === i.id && l.personId === personId).reduce((n, l) => n + l.hours, 0);
      return sum + Math.max(0, (i.estimatedHours ?? 0) - done);
    }, 0);
}

function loadBand(utilisation: number, capacity: number) {
  if (capacity <= 0) return { label: "No working days", icon: "–", fill: "#cbd5e1", text: "text-slate-500" };
  if (utilisation > 100) return { label: "Overloaded", icon: "▲", fill: CRIT, text: "text-red-700" };
  if (utilisation >= 60) return { label: "Healthy", icon: "●", fill: BAR, text: "text-slate-600" };
  return { label: "Light load", icon: "▽", fill: WARN, text: "text-amber-800" };
}

function workloadOf(s: PreviewState, personId: string): Workload {
  const mine = s.items.filter((i) => i.personId === personId);
  const subtasks = mine.filter((i) => i.parentId && isOpen(i));
  const tasks = mine.filter((i) => !i.parentId && isOpen(i));
  return {
    subtasks,
    tasks,
    projects: s.projects.filter((p) => p.ownerId === personId && p.state !== "closed").map((p) => p.id),
    reviews: reviewQueue(s, personId),
    overdue: mine.filter(isOverdue).length,
    open: subtasks.length + tasks.length,
  };
}

export default function TeamPage() {
  // useSearchParams needs a Suspense boundary in Next 16.
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading team…</p>}>
      <TeamView />
    </Suspense>
  );
}

function TeamView() {
  const { state, terms } = usePreview();
  const router = useRouter();
  const params = useSearchParams();
  const notConnected = useNotConnected();

  const [query, setQuery] = useState("");
  const [dept, setDept] = useState<string>("all");
  const [desig, setDesig] = useState<string>("all");
  const [periodKey, setPeriodKey] = useState<PeriodKey>("this_week");
  const period = useMemo(() => periodOf(periodKey), [periodKey]);

  // ?person=<id> (from global search) opens that person's drawer. We track the
  // last seen param so a new search result re-opens the drawer on this page.
  const param = params.get("person");
  const [lastParam, setLastParam] = useState(param);
  const [selected, setSelected] = useState<string | null>(param);
  if (param !== lastParam) {
    setLastParam(param);
    setSelected(param);
  }

  const closeDrawer = useCallback(() => {
    setSelected(null);
    if (param) router.replace("/preview/team", { scroll: false });
  }, [param, router]);

  const loads = useMemo(() => {
    const m = new Map<string, Workload>();
    for (const p of state.people) m.set(p.id, workloadOf(state, p.id));
    return m;
  }, [state]);
  const busiest = Math.max(1, ...[...loads.values()].map((w) => w.open));

  const hours = useMemo(() => {
    const m = new Map<string, Hours>();
    for (const p of state.people) {
      m.set(p.id, { ...personHours(state, p.id, period.from, period.to), bookedAhead: bookedAheadOf(state, p.id) });
    }
    return m;
  }, [state, period]);

  const filtered = state.people.filter((p) => {
    if (dept !== "all" && (p.departmentId ?? "none") !== dept) return false;
    if (desig !== "all" && p.designationId !== desig) return false;
    const q = query.trim().toLowerCase();
    if (q && !`${p.name} ${p.email}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const groups = [...state.departments, { id: "none", name: "No department", color: "slate" }]
    .map((d) => ({ d, people: filtered.filter((p) => (p.departmentId ?? "none") === d.id) }))
    .filter((g) => g.people.length > 0);

  const summary = state.departments.map((d) => {
    const members = state.people.filter((p) => p.departmentId === d.id);
    return {
      d,
      headcount: members.length,
      open: members.reduce((n, p) => n + (loads.get(p.id)?.open ?? 0), 0),
      overdue: members.reduce((n, p) => n + (loads.get(p.id)?.overdue ?? 0), 0),
      logged: members.reduce((n, p) => n + (hours.get(p.id)?.logged ?? 0), 0),
      utilisation: members.length
        ? members.reduce((n, p) => n + (hours.get(p.id)?.utilisation ?? 0), 0) / members.length
        : null,
    };
  });

  const selectedPerson = state.people.find((p) => p.id === selected) ?? null;

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle={`Who is working on what across your ${terms.project.many.toLowerCase()}.`}
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button onClick={notConnected("Inviting people")}>+ Invite person</Button>
            <span className="text-xs text-slate-500">People will sync from the attendance system.</span>
          </div>
        }
      />

      {/* Department summary strip */}
      <div className="-mx-4 mb-6 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
        {summary.map(({ d, headcount, open, overdue, logged, utilisation }) => (
          <button
            key={d.id}
            onClick={() => setDept(dept === d.id ? "all" : d.id)}
            className={`min-w-[150px] rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-indigo-300 ${
              dept === d.id ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200"
            }`}
          >
            <DeptBadge id={d.id} />
            <div className="mt-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-900">{headcount}</span> {headcount === 1 ? "person" : "people"}
            </div>
            <div className="mt-0.5 flex gap-3 text-xs text-slate-500">
              <span><span className="font-semibold text-slate-900">{open}</span> open</span>
              <span className={overdue ? "font-medium text-red-600" : ""}>{overdue} overdue</span>
            </div>
            <div className="mt-0.5 flex gap-3 text-xs text-slate-500" title={`${period.label}: man-hours logged and average utilisation`}>
              <span><span className="font-semibold text-slate-900">{hrs(logged)}</span> logged</span>
              <span>{utilisation === null ? "—" : `${pct(utilisation)} avg util.`}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <Card className="mb-6 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Man-hours for</span>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Period for man-hours">
            {(["this_week", "last_week", "this_month"] as PeriodKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setPeriodKey(k)}
                aria-pressed={periodKey === k}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  periodKey === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {periodOf(k).label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">
            {format(parseISO(period.from), "d MMM")} – {format(parseISO(period.to), "d MMM yyyy")}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            className={inputCls}
            aria-label="Search people"
          />
          <select value={desig} onChange={(e) => setDesig(e.target.value)} className={inputCls} aria-label="Filter by designation">
            <option value="all">All designations</option>
            {state.designations.map((g) => (
              <option key={g.id} value={g.id}>{g.name} · L{g.level}</option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by department">
          {[{ id: "all", name: "All departments" }, ...state.departments].map((d) => (
            <button
              key={d.id}
              onClick={() => setDept(d.id)}
              aria-pressed={dept === d.id}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                dept === d.id ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      </Card>

      {groups.length === 0 ? (
        <EmptyState icon="🔍" title="No one matches those filters" body="Try a different name, or clear the department and designation filters." />
      ) : (
        <div className="space-y-8">
          {groups.map(({ d, people }) => (
            <section key={d.id}>
              <SectionTitle count={people.length}>{d.name}</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {people.map((p) => (
                  <PersonCard key={p.id} person={p} load={loads.get(p.id)!} hours={hours.get(p.id)!} period={period} busiest={busiest} onOpen={() => setSelected(p.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Drawer
        open={!!selectedPerson}
        onClose={closeDrawer}
        title={selectedPerson && <PersonHeader person={selectedPerson} />}
      >
        {selectedPerson && <PersonDetails person={selectedPerson} load={loads.get(selectedPerson.id)!} hours={hours.get(selectedPerson.id)!} period={period} />}
      </Drawer>
    </div>
  );
}

function useDesignation(person: Person) {
  const { state } = usePreview();
  const g = state.designations.find((x) => x.id === person.designationId);
  return g ? `${g.name} · L${g.level}` : "No designation";
}

function PersonCard({ person, load, hours, period, busiest, onOpen }: { person: Person; load: Workload; hours: Hours; period: Period; busiest: number; onOpen: () => void }) {
  const { terms } = usePreview();
  const designation = useDesignation(person);
  return (
    <button
      onClick={onOpen}
      className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
    >
      <div className="flex items-start gap-3">
        <Avatar name={person.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-slate-900">{person.name}</span>
            {person.isAdmin && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Admin</span>}
          </div>
          <div className="truncate text-sm text-slate-500">{designation}</div>
          <div className="mt-1"><DeptBadge id={person.departmentId} /></div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-5 gap-1 text-center">
        <Stat label={terms.subtask.many} value={load.subtasks.length} />
        <Stat label={`${terms.task.many} owned`} value={load.tasks.length} />
        <Stat label={`${terms.project.many} owned`} value={load.projects.length} />
        <Stat label="To review" value={load.reviews.length} tone={load.reviews.length ? "amber" : undefined} />
        <Stat label="Overdue" value={load.overdue} tone={load.overdue ? "red" : undefined} />
      </dl>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>Workload</span>
          <span>{load.open} open {load.open === 1 ? "item" : "items"}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(load.open / busiest) * 100}%` }} />
        </div>
      </div>

      <HoursMeter hours={hours} period={period} />
    </button>
  );
}

/** Logged vs capacity for the period, a utilisation meter, and hours booked ahead. */
function HoursMeter({ hours, period }: { hours: Hours; period: Period }) {
  const band = loadBand(hours.utilisation, hours.capacity);
  const width = Math.min(100, hours.utilisation);
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="mb-1 flex justify-between gap-2 text-xs text-slate-500">
        <span>Man-hours · {period.label.toLowerCase()}</span>
        <span>
          <span className="font-semibold text-slate-900">{hrs(hours.logged)}</span> of {hrs(hours.capacity)}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={`${hrs(hours.logged)} logged of ${hrs(hours.capacity)} capacity, ${pct(hours.utilisation)} utilisation, ${band.label}`}
        title={`${pct(hours.utilisation)} utilisation · ${band.label}`}
      >
        <div className="h-full rounded-full" style={{ width: `${width}%`, minWidth: hours.logged ? 4 : 0, background: band.fill }} />
      </div>
      <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs">
        <span className={`font-medium ${band.text}`}>
          <span aria-hidden>{band.icon}</span> {pct(hours.utilisation)} · {band.label}
        </span>
        <span className="text-slate-500" title="Estimated hours left on their open items, minus what they have already logged on them">
          Booked ahead <span className="font-semibold text-slate-900">{hrs(hours.bookedAhead)}</span>
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "red" | "amber" }) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-1 py-1.5">
      <dd className={`text-base font-semibold ${color}`}>{value}</dd>
      <dt className="truncate text-[10px] leading-tight text-slate-500" title={label}>{label}</dt>
    </div>
  );
}

function PersonHeader({ person }: { person: Person }) {
  const designation = useDesignation(person);
  return (
    <div className="flex items-center gap-3">
      <Avatar name={person.name} size="lg" />
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold text-slate-900">{person.name}</div>
        <div className="truncate text-sm text-slate-500">{designation}</div>
      </div>
    </div>
  );
}

function PersonDetails({ person, load, hours, period }: { person: Person; load: Workload; hours: Hours; period: Period }) {
  const { state, terms } = usePreview();
  const byDue = (a: WorkItem, b: WorkItem) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <DeptBadge id={person.departmentId} />
        <a href={`mailto:${person.email}`} className="text-indigo-600 hover:underline">{person.email}</a>
        {person.isAdmin && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">Admin</span>}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
        <Stat label={terms.subtask.many} value={load.subtasks.length} />
        <Stat label={`${terms.task.many} owned`} value={load.tasks.length} />
        <Stat label={`${terms.project.many} owned`} value={load.projects.length} />
        <Stat label="To review" value={load.reviews.length} tone={load.reviews.length ? "amber" : undefined} />
        <Stat label="Overdue" value={load.overdue} tone={load.overdue ? "red" : undefined} />
      </div>

      <TimeThisPeriod person={person} hours={hours} period={period} />

      <WorkList title={`${terms.subtask.many} assigned`} items={[...load.subtasks].sort(byDue)} empty={`No open ${terms.subtask.many.toLowerCase()}.`} />
      <WorkList title={`${terms.task.many} they own`} items={[...load.tasks].sort(byDue)} empty={`No open ${terms.task.many.toLowerCase()}.`} />
      <WorkList title="Waiting for their review" items={load.reviews} empty="Nothing waiting for their review." />

      <div>
        <SectionTitle count={load.projects.length}>{terms.project.many} they own</SectionTitle>
        {load.projects.length === 0 ? (
          <p className="text-sm text-slate-500">None.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {load.projects.map((id) => (
              <li key={id}>
                <Link href={`/preview/projects/${id}`} className="block px-3 py-2 text-sm text-slate-800 hover:bg-slate-50">
                  {projectById(state, id)?.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <NotConnectedTag label="Attendance sync not connected yet" />
        Leave and availability will show here once connected.
      </p>
    </div>
  );
}

function TimeThisPeriod({ person, hours, period }: { person: Person; hours: Hours; period: Period }) {
  const { state, terms } = usePreview();
  const logs = state.timeLogs
    .filter((l) => l.personId === person.id && l.date >= period.from && l.date <= period.to)
    .sort((a, b) => b.date.localeCompare(a.date));

  const days = new Map<string, typeof logs>();
  for (const l of logs) days.set(l.date, [...(days.get(l.date) ?? []), l]);

  const byProject = new Map<string, number>();
  for (const l of logs) {
    const pid = state.items.find((i) => i.id === l.itemId)?.projectId ?? "unknown";
    byProject.set(pid, (byProject.get(pid) ?? 0) + l.hours);
  }
  const projectRows = [...byProject.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <SectionTitle count={logs.length}>Time this period</SectionTitle>
      <p className="-mt-1 text-xs text-slate-500">
        {period.label}, {format(parseISO(period.from), "d MMM")} – {format(parseISO(period.to), "d MMM")}
      </p>
      <HoursMeter hours={hours} period={period} />

      {logs.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No time logged in this period.</p>
      ) : (
        <>
          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">By {terms.project.one.toLowerCase()}</h3>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {projectRows.map(([pid, h]) => {
              const proj = projectById(state, pid);
              return (
                <li key={pid} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  {proj ? (
                    <Link href={`/preview/projects/${pid}`} className="min-w-0 truncate text-slate-800 hover:text-indigo-600 hover:underline">
                      {proj.name}
                    </Link>
                  ) : (
                    <span className="text-slate-500">Unknown</span>
                  )}
                  <span className="shrink-0 font-medium tabular-nums text-slate-800">{hrs(h)}</span>
                </li>
              );
            })}
          </ul>

          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">By day</h3>
          <div className="space-y-3">
            {[...days.entries()].map(([date, entries]) => (
              <div key={date} className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs">
                  <span className="font-medium text-slate-700">{format(parseISO(date), "EEE d MMM")}</span>
                  <span className="font-semibold tabular-nums text-slate-800">{hrs(entries.reduce((n, l) => n + l.hours, 0))}</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {entries.map((l) => {
                    const item = state.items.find((i) => i.id === l.itemId);
                    return (
                      <li key={l.id} className="flex items-start gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <Link href={itemLink(state, l.itemId)} className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-600 hover:underline">
                            {item?.title ?? "Deleted item"}
                          </Link>
                          <span className="block truncate text-xs text-slate-500">
                            {item ? projectById(state, item.projectId)?.name : ""}
                            {l.note && <> · {l.note}</>}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-medium tabular-nums text-slate-800">{hrs(l.hours)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function WorkList({ title, items, empty }: { title: string; items: WorkItem[]; empty: string }) {
  const { state } = usePreview();
  return (
    <div>
      <SectionTitle count={items.length}>{title}</SectionTitle>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {items.map((i) => (
            <li key={i.id}>
              <Link href={itemLink(state, i.id)} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-slate-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{i.title}</span>
                  <span className="block truncate text-xs text-slate-500">{projectById(state, i.projectId)?.name}</span>
                </span>
                <StatusPill status={i.status} />
                <DueLabel date={i.dueDate} status={i.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
