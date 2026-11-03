import Link from "next/link";
import { StatCard } from "@/components/Cards";
import type { PersonDay, Stretch } from "@/lib/time-metrics";
import type { TimeDayReport } from "@/lib/time-data";
import { formatMinutes } from "@/lib/work-hours";

/**
 * One day of clocked-in time against time on tasks, per person.
 *
 * Today it is live: who is working on what, who is clocked in with no timer,
 * who has clocked out. Each person opens to their timeline and the tasks and
 * subtasks their time went to.
 */

function istTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

function taskLink(s: { projectId: number; taskId: number; subtaskId: number | null }) {
  return `/projects/${s.projectId}?task=${s.taskId}${s.subtaskId ? `&subtask=${s.subtaskId}` : ""}`;
}

const STATE: Record<PersonDay["state"], { label: string; cls: string }> = {
  working: { label: "Working", cls: "bg-emerald-100 text-emerald-800" },
  idle: { label: "Clocked in · no timer", cls: "bg-amber-100 text-amber-800" },
  clocked_out: { label: "Clocked out", cls: "bg-slate-100 text-slate-700" },
  not_in: { label: "Not in", cls: "bg-slate-50 text-slate-500" },
};

function UtilBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  const p = Math.round(value * 100);
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        <span
          className={`block h-full rounded-full ${p >= 70 ? "bg-emerald-500" : p >= 40 ? "bg-amber-500" : "bg-rose-400"}`}
          style={{ width: `${p}%` }}
        />
      </span>
      <span className="figure text-xs text-slate-700">{p}%</span>
    </span>
  );
}

/** The clocked-in span as a grey bar with each timer stretch on it in green. */
function Timeline({ day, now, isToday }: { day: PersonDay; now: string; isToday: boolean }) {
  const toMs = (s: string) => new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").getTime();
  const firstIn = day.clock.firstIn ? toMs(day.clock.firstIn) : null;
  const lastOut = day.clock.clockedIn && isToday ? toMs(now) : day.clock.lastOut ? toMs(day.clock.lastOut) : null;
  const points = [
    ...(firstIn ? [firstIn] : []),
    ...(lastOut ? [lastOut] : []),
    ...day.timeline.flatMap((t) => [toMs(t.start), toMs(t.end)]),
  ];
  if (points.length < 2) return null;
  const from = Math.min(...points);
  const to = Math.max(...points);
  const span = Math.max(1, to - from);
  const left = (ms: number) => `${((ms - from) / span) * 100}%`;
  const width = (a: number, b: number) => `${Math.max(0.5, ((b - a) / span) * 100)}%`;
  return (
    <div>
      <div className="relative h-5 overflow-hidden rounded bg-slate-100" role="img" aria-label="Clocked-in time with work timer stretches">
        {firstIn && lastOut && (
          <span className="absolute inset-y-0 bg-slate-200" style={{ left: left(firstIn), width: width(firstIn, lastOut) }} />
        )}
        {day.timeline.map((t: Stretch, i) => (
          <span
            key={i}
            title={`${t.label}: ${istTime(t.start)}–${t.running ? "now" : istTime(t.end)}`}
            className={`absolute inset-y-0.5 rounded-sm ${t.running ? "animate-pulse bg-emerald-500" : "bg-emerald-400"}`}
            style={{ left: left(toMs(t.start)), width: width(toMs(t.start), toMs(t.end)) }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{istTime(new Date(from).toISOString())}</span>
        <span>{istTime(new Date(to).toISOString())}</span>
      </div>
    </div>
  );
}

function PersonDetail({ day, now, isToday }: { day: PersonDay; now: string; isToday: boolean }) {
  return (
    <div className="space-y-4 bg-slate-50 px-4 py-4">
      <Timeline day={day} now={now} isToday={isToday} />
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">First task after clock-in</dt>
          <dd className="figure font-medium text-slate-900">
            {day.firstStartDelay == null ? "—" : `${formatMinutes(day.firstStartDelay)} later`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Stretches of work</dt>
          <dd className="figure font-medium text-slate-900">
            {day.stretches} {day.switches > 0 && <span className="text-xs text-slate-500">({day.switches} switches)</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Longest stretch</dt>
          <dd className="figure font-medium text-slate-900">{day.longestStretch ? formatMinutes(day.longestStretch) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Added by hand</dt>
          <dd className="figure font-medium text-slate-900">{day.manualMinutes ? formatMinutes(day.manualMinutes) : "—"}</dd>
        </div>
      </dl>
      {day.items.length > 0 ? (
        <table className="w-full text-sm">
          <caption className="sr-only">Time by task and subtask</caption>
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 font-medium">Worked on</th>
              <th className="py-1 font-medium">Project</th>
              <th className="py-1 text-right font-medium">Stretches</th>
              <th className="py-1 text-right font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {day.items.map((i) => (
              <tr key={`${i.taskId}|${i.subtaskId ?? ""}`}>
                <td className="py-1.5 pr-2">
                  <Link href={taskLink(i)} className="font-medium text-slate-900 hover:underline">
                    {i.subtaskTitle ?? i.taskTitle}
                  </Link>
                  {i.subtaskTitle && <span className="block text-xs text-slate-500">{i.taskTitle}</span>}
                </td>
                <td className="py-1.5 pr-2 text-slate-600">{i.projectName}</td>
                <td className="figure py-1.5 text-right text-slate-600">{i.stretches}</td>
                <td className="figure py-1.5 text-right font-semibold text-slate-900">{formatMinutes(i.minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-slate-500">No work timer ran this day.</p>
      )}
    </div>
  );
}

export default function TimeDayView({ report, now, isToday }: { report: TimeDayReport; now: string; isToday: boolean }) {
  const { people, totals } = report;
  if (!people.length) {
    return <p className="rounded-xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200">Nobody to show for this day.</p>;
  }
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isToday && !report.ownOnly ? (
          <StatCard
            label="Working right now"
            value={`${totals.workingNow} of ${totals.clockedInNow}`}
            hint={`clocked in · ${totals.idleNow} with no timer`}
            tone="running"
          />
        ) : (
          <StatCard label="Clocked in" value={formatMinutes(totals.clockedMinutes)} hint="from the Attendance app" />
        )}
        <StatCard label="On tasks" value={formatMinutes(totals.trackedMinutes)} hint="work timer, while clocked in" tone="done" />
        <StatCard label="No timer running" value={formatMinutes(totals.idleMinutes)} hint="clocked in, not on a task" tone="review" />
        <StatCard label="Time on tasks" value={pct(totals.utilisation)} hint="share of clocked-in time" />
      </div>

      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-3 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 md:grid">
          <span>Person</span>
          <span>{isToday ? "Now" : "Clocked"}</span>
          <span className="text-right">Clocked in</span>
          <span className="text-right">On tasks</span>
          <span className="text-right">No timer</span>
          <span>Time on tasks</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {people.map((d) => (
            <li key={d.userId}>
              <details open={report.ownOnly}>
                <summary className="grid cursor-pointer list-none grid-cols-2 items-center gap-3 px-4 py-3 hover:bg-slate-50 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">{d.name}</span>
                    {d.department && <span className="block truncate text-xs text-slate-500">{d.department}</span>}
                  </span>
                  <span className="min-w-0 text-xs">
                    {isToday && (
                      <span className={`inline-block rounded-full px-2 py-0.5 font-semibold ${STATE[d.state].cls}`}>
                        {STATE[d.state].label}
                      </span>
                    )}
                    {d.running ? (
                      <span className="mt-0.5 block truncate text-slate-600">{d.running.label}</span>
                    ) : d.clock.firstIn ? (
                      <span className="mt-0.5 block text-slate-500">
                        {istTime(d.clock.firstIn)} – {d.clock.clockedIn && isToday ? "now" : istTime(d.clock.lastOut)}
                        {d.clock.sessions > 1 ? ` · ${d.clock.sessions} sessions` : ""}
                      </span>
                    ) : null}
                  </span>
                  <span className="figure text-sm text-slate-700 md:text-right">
                    <span className="text-xs text-slate-500 md:hidden">Clocked </span>
                    {d.clockedMinutes ? formatMinutes(d.clockedMinutes) : "—"}
                  </span>
                  <span className="figure text-sm font-semibold text-emerald-700 md:text-right">
                    <span className="text-xs font-normal text-slate-500 md:hidden">On tasks </span>
                    {d.trackedMinutes ? formatMinutes(d.trackedMinutes) : "—"}
                  </span>
                  <span className="figure text-sm text-amber-700 md:text-right">
                    <span className="text-xs text-slate-500 md:hidden">No timer </span>
                    {d.clockedMinutes ? formatMinutes(d.idleMinutes) : "—"}
                  </span>
                  <UtilBar value={d.utilisation} />
                </summary>
                <PersonDetail day={d} now={now} isToday={isToday} />
              </details>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-slate-500">
        “No timer running” is clocked-in time with no task timer on — meetings, reading and helping
        others land here unless someone starts a timer for them. Read it as a prompt, not a score.
      </p>
    </div>
  );
}
