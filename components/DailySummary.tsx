"use client";

import { formatMinutes, type DailySummary as Summary } from "@/lib/daily-summary-shape";

/**
 * The day as the app recorded it — nothing to fill in.
 *
 * It is here so the planner's daily tab is true without anyone maintaining
 * it: the time logs, finished tasks and meetings are already being written
 * as people work. The note below it is for what these cannot say.
 */
export default function DailySummaryPanel({ summary }: { summary: Summary }) {
  if (summary.empty) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">
        Nothing recorded for this day yet. Log time on a task, finish one, or sit in a
        meeting, and it appears here by itself.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800">What the day held</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          filled in by itself
        </span>
      </div>

      <dl className="mb-4 grid grid-cols-2 divide-slate-200 text-center sm:grid-cols-4 sm:divide-x">
        {[
          ["Logged", formatMinutes(summary.totalMinutes)],
          ["Finished", String(summary.completed.length)],
          ["Extra work", String(summary.extra.length)],
          ["Meetings", String(summary.meetings.length)],
        ].map(([label, value]) => (
          <div key={label} className="px-2 py-1">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>

      {summary.worked.length > 0 && (
        <section className="mb-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Worked on
          </h3>
          <ul className="space-y-1">
            {summary.worked.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 text-sm">
                <span className="text-slate-700">{t.title}</span>
                {t.is_additional && (
                  <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                    extra
                  </span>
                )}
                {t.project_name && (
                  <span className="text-xs text-slate-500">{t.project_name}</span>
                )}
                <span className="ml-auto shrink-0 font-medium text-slate-600">
                  {formatMinutes(t.minutes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.completed.length > 0 && (
        <section className="mb-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Finished
          </h3>
          <ul className="space-y-1">
            {summary.completed.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 text-sm text-slate-700">
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
        </section>
      )}

      {summary.extra.length > 0 && (
        <section className="mb-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-violet-700">
            Extra work that came in
          </h3>
          <ul className="space-y-1">
            {summary.extra.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 text-sm text-slate-700">
                <span aria-hidden="true" className="text-violet-600">
                  +
                </span>
                {t.title}
                {t.project_name && (
                  <span className="text-xs text-slate-500">{t.project_name}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-violet-800">
            Follow-up work raised after something was already finished — nobody planned
            this at the start of the day.
          </p>
        </section>
      )}

      {(summary.meetings.length > 0 || summary.comments > 0) && (
        <p className="text-xs text-slate-600">
          {summary.meetings.length > 0 && (
            <>
              <span className="font-medium">Meetings:</span>{" "}
              {summary.meetings.map((m) => `${m.at} ${m.title}`).join(" · ")}
            </>
          )}
          {summary.meetings.length > 0 && summary.comments > 0 && " · "}
          {summary.comments > 0 && (
            <>
              {summary.comments} comment{summary.comments === 1 ? "" : "s"}
            </>
          )}
        </p>
      )}
    </div>
  );
}
