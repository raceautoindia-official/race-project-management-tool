"use client";

import {
  formatMinutes,
  type UpcomingTask,
  type WeekSummary as Week,
} from "@/lib/planner-summary-shape";

const PRIORITY_COLOUR: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-blue-100 text-blue-700",
  low: "bg-slate-100 text-slate-600",
};

type Finished = Week["completed"][number];

/** The week's finished tasks, in the order the days ran. */
function groupByDay(items: Finished[]): [string, Finished[]][] {
  const byDay = new Map<string, Finished[]>();
  for (const item of items) {
    const list = byDay.get(item.completed_on);
    if (list) list.push(item);
    else byDay.set(item.completed_on, [item]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** "Mon 5 Oct". */
function dayHeading(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function dayLabel(date: string | null): string {
  if (!date) return "no date";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The week, from the board and from the work already logged.
 *
 * The upcoming list is a proposal — the tasks that are actually due — so a
 * plan starts from what is on someone rather than from an empty box. What
 * they make of it is still theirs to write underneath.
 */
export default function WeekSummaryPanel({
  summary,
  show,
  onUseAsPlan,
  planned,
}: {
  summary: Week;
  /** "upcoming" is what the week is for; "held" is what it came to. */
  show: "upcoming" | "held";
  /** Adds the given titles to the plan, to edit from there. */
  onUseAsPlan: (titles: string[]) => void;
  /** Titles already in the plan, so each row knows whether it is in. */
  planned: string[];
}) {
  const { upcoming } = summary;
  const estimated = upcoming.reduce((sum, t) => sum + Number(t.estimated_hours ?? 0), 0);

  if (show === "held") {
    return (
      <div className="mb-4">
        <WeekHeld summary={summary} />
      </div>
    );
  }

  return (
    <div className="mb-4 space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            What is due this week
          </h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            from your tasks
          </span>
          {upcoming.length > 0 && (
            <button
              type="button"
              onClick={() => onUseAsPlan(upcoming.map((t) => t.title))}
              className="ml-auto rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            >
              ↓ Add all to my plan
            </button>
          )}
        </div>

        {upcoming.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing with a due date falls in this week. Write the plan yourself below.
          </p>
        ) : (
          <>
            <ul className="space-y-1">
              {upcoming.map((t: UpcomingTask) => (
                <li key={t.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  {/* One at a time is how a plan actually gets written. */}
                  {planned.includes(t.title.trim().toLowerCase()) ? (
                    <span
                      aria-label={`${t.title} is in your plan`}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold text-green-700"
                    >
                      ✓
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onUseAsPlan([t.title])}
                      aria-label={`Add "${t.title}" to my plan`}
                      title="Add this one to my plan"
                      className="shrink-0 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                    >
                      +
                    </button>
                  )}
                  <span className="text-slate-700">{t.title}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                      PRIORITY_COLOUR[t.priority] ?? PRIORITY_COLOUR.low
                    }`}
                  >
                    {t.priority}
                  </span>
                  {t.overdue && (
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                      carried over
                    </span>
                  )}
                  {t.project_name && (
                    <span className="text-xs text-slate-500">{t.project_name}</span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-slate-600">
                    {dayLabel(t.due_date)}
                    {t.estimated_hours ? ` · ${Number(t.estimated_hours)}h` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              {upcoming.length} task{upcoming.length === 1 ? "" : "s"}
              {estimated ? `, ${estimated}h estimated` : ""} — a proposal, not a
              commitment. Add them one at a time with <strong>+</strong>, or all at
              once, then change them below and press <strong>Save</strong>.
            </p>
          </>
        )}
      </section>

    </div>
  );
}

/** What the week came to: hours, days, what was finished, what came in. */
function WeekHeld({ summary }: { summary: Week }) {
  return (
    <>
      {summary.empty ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">
          Nothing recorded for this week yet. Log time on a task, finish one, or sit in
          a meeting, and it appears here by itself.
        </p>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-800">
              What the week held
            </h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              filled in by itself
            </span>
          </div>

          <dl className="mb-3 grid grid-cols-2 divide-slate-200 text-center sm:grid-cols-4 sm:divide-x">
            {[
              ["Logged", formatMinutes(summary.totalMinutes)],
              ["Days worked", String(summary.daysWorked)],
              ["Finished", String(summary.completed.length)],
              ["Extra work", String(summary.extra.length)],
            ].map(([label, value]) => (
              <div key={label} className="px-2 py-1">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {label}
                </dt>
                <dd className="mt-0.5 text-sm font-semibold text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>

          {summary.completed.length > 0 ? (
            <>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Finished this week ({summary.completed.length})
              </h3>
              {/* By the day it was finished, so the week reads as a week
                  rather than as a pile. */}
              {groupByDay(summary.completed).map(([day, items]) => (
                <div key={day} className="mb-2">
                  <p className="text-xs font-medium text-slate-500">{dayHeading(day)}</p>
                  <ul className="space-y-1">
                    {items.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-baseline gap-2 text-sm text-slate-700"
                      >
                        <span aria-hidden="true" className="text-green-600">
                          ✓
                        </span>
                        {t.title}
                        {t.project_name && (
                          <span className="text-xs text-slate-500">{t.project_name}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Nothing finished this week yet. Tasks appear here on the day they are
              marked Done.
            </p>
          )}

          {summary.extra.length > 0 && (
            <p className="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
              <span className="font-semibold">
                {summary.extra.length} piece
                {summary.extra.length === 1 ? "" : "s"} of extra work
              </span>{" "}
              came in this week: {summary.extra.map((t) => t.title).join(", ")}.
            </p>
          )}
        </section>
      )}
    </>
  );
}
