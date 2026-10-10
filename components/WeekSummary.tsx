"use client";

import { EmptyRecord, RecordCard, Strand } from "@/components/RecordPanel";
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
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            What is due this week
          </h2>
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
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
        <EmptyRecord>
          Nothing recorded for this week yet. Log time on a task, finish one, or sit in
          a meeting, and it appears here by itself.
        </EmptyRecord>
      ) : (
        <RecordCard
          title="What the week held"
          badge="filled in by itself"
          measures={[
            {
              label: "Logged",
              value: formatMinutes(summary.totalMinutes),
              tone: "time",
              live: summary.totalMinutes > 0,
            },
            {
              label: "Days worked",
              value: String(summary.daysWorked),
              tone: "span",
              live: summary.daysWorked > 0,
            },
            {
              label: "Finished",
              value: String(summary.completed.length),
              tone: "done",
              live: summary.completed.length > 0,
            },
            {
              label: "Extra work",
              value: String(summary.extra.length),
              tone: "extra",
              live: summary.extra.length > 0,
            },
          ]}
        >
          {summary.completed.length > 0 ? (
            <section>
              <Strand tone="done">
                Finished this week ({summary.completed.length})
              </Strand>
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
                        <span aria-hidden="true" className="text-emerald-600">
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
            </section>
          ) : (
            <p className="text-sm text-slate-600">
              Nothing finished this week yet. Tasks appear here on the day they are
              marked Done.
            </p>
          )}

          {summary.extra.length > 0 && (
            <section className="rounded-xl bg-violet-50 p-3 ring-1 ring-violet-200">
              <Strand tone="extra">
                {summary.extra.length} piece
                {summary.extra.length === 1 ? "" : "s"} of extra work came in
              </Strand>
              <p className="text-sm text-violet-900">
                {summary.extra.map((t) => t.title).join(", ")}.
              </p>
            </section>
          )}
        </RecordCard>
      )}
    </>
  );
}
