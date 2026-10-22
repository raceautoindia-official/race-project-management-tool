"use client";

import { forecast, scheduleHealth, type Forecast } from "@/lib/work-engine";
import { todayIST } from "@/lib/work-dates";
import { HealthBadge, shortDate } from "./kit";

/**
 * The schedule as a picture: how much of the planned time is used against
 * how much work is approved, and when it will finish at the pace so far
 * (lib/work-engine.ts forecast). Two bars on one scale — when the work bar
 * is shorter than the time bar, it is behind — over a date line with today,
 * the due date and the forecast finish marked.
 *
 *   full     project and task headers
 *   compact  cards and lists: the two bars and one line of forecast
 */
export default function ScheduleTrack({
  approved,
  pending = 0,
  start,
  due,
  variant = "full",
  className = "",
}: {
  approved: number;
  pending?: number;
  start: string | null | undefined;
  due: string | null | undefined;
  variant?: "full" | "compact";
  className?: string;
}) {
  const today = todayIST();
  const s = start ? String(start).slice(0, 10) : null;
  const d = due ? String(due).slice(0, 10) : null;
  const f = forecast(approved, s, d, today);
  const { expected } = scheduleHealth(approved, s, d, today);
  const tone = etaTone(f);
  const startsIn = s ? Math.round((Date.parse(s) - Date.parse(today)) / 86_400_000) : 0;
  const a = clamp(approved);
  const p = Math.min(100 - a, clamp(pending));

  const timeBar = (h: string) => (
    <Bar h={h} label="Time used" value={f.timePct ?? 0} title={timeLabel(f)}>
      <div
        className={`h-full rounded-full ${f.daysLeft !== null && f.daysLeft < 0 && f.kind !== "done" ? "bg-gradient-to-r from-orange-400 to-red-500" : "bg-gradient-to-r from-sky-400 to-cyan-500"}`}
        style={{ width: `${f.timePct ?? 0}%` }}
      />
    </Bar>
  );
  const workBar = (h: string) => (
    <Bar h={h} label="Work approved" value={a} title={`${Math.round(a)}% approved${p > 0.5 ? ` · ${Math.round(p)}% waiting for review` : ""}`}>
      <div
        className={`h-full ${a >= 99.5 ? "bg-gradient-to-r from-emerald-400 to-green-500" : "bg-gradient-to-r from-indigo-500 to-violet-500"}`}
        style={{ width: `${a}%` }}
      />
      {p > 0 && (
        <div
          className="h-full bg-amber-300"
          style={{ width: `${p}%`, backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.5) 0 4px, transparent 4px 8px)" }}
        />
      )}
      {expected !== null && f.kind === "projected" && (
        <span
          className="absolute -top-1 -bottom-1 w-0.5 rounded bg-slate-800"
          style={{ left: `calc(${Math.min(100, expected)}% - 1px)` }}
          title={`Where it should be by today: ${Math.round(expected)}%`}
        />
      )}
    </Bar>
  );

  if (variant === "compact") {
    return (
      <div className={`space-y-1.5 ${className}`}>
        <Row label="Time" right={timeShort(f)}>{timeBar("h-1.5")}</Row>
        <Row label="Work" right={`${Math.round(a)}%`}>{workBar("h-1.5")}</Row>
        <p className={`text-xs font-medium ${tone.text}`}>{forecastSentence(f, d, startsIn, true)}</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl bg-white p-4 ring-1 ring-slate-200 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <span aria-hidden>📅</span> Schedule
          <HealthBadge approved={approved} start={s} due={d} />
        </h3>
        {f.kind === "projected" && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone.chip}`}>
            <span aria-hidden>◆</span> Forecast finish {shortDate(f.eta)}
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        <Row label="Time used" right={timeLabel(f)} wide>{timeBar("h-3")}</Row>
        <Row label="Work approved" right={`${Math.round(a)}%${p > 0.5 ? ` (+${Math.round(p)}% in review)` : ""}`} wide>{workBar("h-3")}</Row>
      </div>

      {s && <DateLine start={s} due={d} today={today} f={f} tone={tone} />}

      <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${tone.note}`}>
        {forecastSentence(f, d, startsIn, false)}
        {f.kind === "projected" && expected !== null && (
          <span className="font-normal text-slate-600"> The black line on the work bar is where it should be by today ({Math.round(expected)}%).</span>
        )}
      </p>
    </div>
  );
}

/** Start ● ─── today ┃ ─── 🏁 due ─── ◆ forecast, on one scale. */
function DateLine({ start, due, today, f, tone }: { start: string; due: string | null; today: string; f: Forecast; tone: Tone }) {
  const n = (x: string) => Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10)) / 86_400_000;
  const s = n(start);
  const points = [n(today), due ? n(due) : s, f.eta ? n(f.eta) : s];
  const end = Math.max(s + 1, ...points);
  const at = (x: number) => Math.max(0, Math.min(100, ((x - s) / (end - s)) * 100));
  const dueAt = due ? at(n(due)) : null;
  const etaAt = f.eta ? at(n(f.eta)) : null;
  const todayAt = at(n(today));

  // Labels sit in lanes so they never sit on top of each other: today above
  // the line, start and due below it, the forecast on its own row under that.
  return (
    <div className="relative mt-4 h-[4.5rem] select-none" aria-hidden>
      {/* the line, and the stretch past the due date if it will run late */}
      <div className="absolute left-0 right-0 top-[22px] h-1 rounded-full bg-slate-200" />
      <div className="absolute left-0 top-[22px] h-1 rounded-full bg-sky-300" style={{ width: `${todayAt}%` }} />
      {dueAt !== null && etaAt !== null && etaAt > dueAt && (
        <div className="absolute top-[22px] h-1 rounded-full bg-red-300" style={{ left: `${dueAt}%`, width: `${etaAt - dueAt}%` }} />
      )}

      <Pin at={0} lane="below" label={shortDate(start)} sub="Start">
        <span className="block h-3 w-3 rounded-full border-2 border-white bg-slate-500 shadow" />
      </Pin>
      {dueAt !== null && (
        <Pin at={dueAt} lane="below" label={shortDate(due)} sub="Due">
          <span className="block text-base leading-none">🏁</span>
        </Pin>
      )}
      {etaAt !== null && f.kind === "projected" && (
        <Pin at={etaAt} lane="forecast" label={shortDate(f.eta)} sub="Forecast" tone={tone.text}>
          <span className={`block h-3.5 w-3.5 rotate-45 rounded-sm border-2 border-white shadow ${tone.dot}`} />
        </Pin>
      )}
      {f.kind !== "not_started" && (
        <Pin at={todayAt} lane="above" label="Today" sub="" tone="font-semibold text-slate-800">
          <span className="block h-5 w-1 rounded bg-slate-800" />
        </Pin>
      )}
    </div>
  );
}

const LANE_TOP = { above: "top-0", below: "top-[34px]", forecast: "top-[52px]" } as const;

/** A marker on the line at `at`% and its label in its lane, kept inside the box at the ends. */
function Pin({
  at,
  lane,
  label,
  sub,
  children,
  tone = "text-slate-600",
}: {
  at: number;
  lane: keyof typeof LANE_TOP;
  label: string;
  sub: string;
  children: React.ReactNode;
  tone?: string;
}) {
  const shift = at < 8 ? "translate-x-0" : at > 92 ? "-translate-x-full" : "-translate-x-1/2";
  return (
    <>
      <div className="absolute top-6 -translate-x-1/2 -translate-y-1/2" style={{ left: `${at}%` }}>
        {children}
      </div>
      <span className={`absolute ${LANE_TOP[lane]} ${shift} whitespace-nowrap text-[11px] leading-tight ${tone}`} style={{ left: `${at}%` }}>
        {sub ? <span className="text-slate-400">{sub} </span> : null}
        {label}
      </span>
    </>
  );
}

/** Label · bar · figure on one line; on a phone the label and figure go above the bar so it keeps its width. */
function Row({ label, right, children, wide = false }: { label: string; right: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-xs sm:hidden">
        <span className="font-medium text-slate-500">{label}</span>
        <span className="tabular-nums text-slate-700">{right}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`${wide ? "w-28" : "w-10"} hidden shrink-0 text-xs font-medium text-slate-500 sm:block`}>{label}</span>
        <div className="min-w-0 flex-1">{children}</div>
        <span className={`${wide ? "w-40" : "w-20"} hidden shrink-0 text-right text-xs tabular-nums text-slate-700 sm:block`}>{right}</span>
      </div>
    </div>
  );
}

function Bar({ h, label, value, title, children }: { h: string; label: string; value: number; title: string; children: React.ReactNode }) {
  return (
    <div
      className={`relative flex w-full overflow-visible rounded-full bg-slate-100 ${h}`}
      role="progressbar"
      aria-label={`${label}: ${title}`}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      title={title}
    >
      <div className="flex h-full w-full overflow-hidden rounded-full">{children}</div>
    </div>
  );
}

// ── Words ─────────────────────────────────────────────────────────────────

interface Tone {
  text: string;
  chip: string;
  note: string;
  dot: string;
}

function etaTone(f: Forecast): Tone {
  if (f.kind === "done" || (f.kind === "projected" && (f.daysLate === null || f.daysLate <= 0))) {
    return { text: "text-emerald-700", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", note: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" };
  }
  if (f.kind === "projected" && f.daysLate !== null && f.daysLate <= 7) {
    return { text: "text-amber-700", chip: "bg-amber-50 text-amber-800 ring-amber-200", note: "bg-amber-50 text-amber-900", dot: "bg-amber-500" };
  }
  if (f.kind === "projected") {
    return { text: "text-red-700", chip: "bg-red-50 text-red-700 ring-red-200", note: "bg-red-50 text-red-800", dot: "bg-red-500" };
  }
  return { text: "text-slate-600", chip: "bg-slate-50 text-slate-600 ring-slate-200", note: "bg-slate-50 text-slate-700", dot: "bg-slate-400" };
}

function forecastSentence(f: Forecast, due: string | null, startsIn: number, short: boolean): string {
  switch (f.kind) {
    case "done":
      return "✓ All work approved.";
    case "no_start":
      return short ? "Add a start date to see a forecast." : "Add a start date to see the timeline and a forecast finish.";
    case "not_started":
      return startsIn === 1 ? "Starts tomorrow." : `Starts in ${startsIn} days.`;
    case "no_pace":
      return short ? "No approved work yet — no forecast." : "Nothing is approved yet, so there is no pace to forecast from. The first approved subtask starts the forecast.";
    case "projected": {
      const when = shortDate(f.eta);
      if (f.daysLate === null) return `At this pace it finishes around ${when}.`;
      if (f.daysLate < 0) return `At this pace it finishes around ${when} — ${-f.daysLate} day${f.daysLate === -1 ? "" : "s"} before the due date (${shortDate(due)}).`;
      if (f.daysLate === 0) return `At this pace it finishes on the due date, ${when}.`;
      return `At this pace it finishes around ${when} — ${f.daysLate} day${f.daysLate === 1 ? "" : "s"} after the due date (${shortDate(due)}).`;
    }
  }
}

function timeLabel(f: Forecast): string {
  if (f.kind === "done") return "Finished";
  if (f.totalDays === null) return f.kind === "no_start" ? "No start date" : "No due date";
  if (f.kind === "not_started") return `${f.totalDays} days planned`;
  if (f.daysLeft !== null && f.daysLeft < 0) return `Overdue by ${-f.daysLeft} day${f.daysLeft === -1 ? "" : "s"}`;
  return `Day ${Math.min(f.elapsedDays, f.totalDays)} of ${f.totalDays} · ${f.daysLeft} left`;
}

function timeShort(f: Forecast): string {
  if (f.kind === "done") return "Done";
  if (f.totalDays === null) return "—";
  if (f.kind === "not_started") return "Not started";
  if (f.daysLeft !== null && f.daysLeft < 0) return `${-f.daysLeft}d over`;
  return `${f.daysLeft}d left`;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Number(n) || 0));
}
