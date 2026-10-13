"use client";

import {
  EmptyRecord,
  RecordCard,
  Strand,
  type MeasureItem,
} from "@/components/RecordPanel";
import { formatMinutes, type DailySummary as Summary } from "@/lib/planner-summary-shape";

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
      <EmptyRecord>
        Nothing recorded for this day yet. Log time on a task, finish one, or sit in a
        meeting, and it appears here by itself.
      </EmptyRecord>
    );
  }

  const measures: MeasureItem[] = [
    {
      label: "Logged",
      value: formatMinutes(summary.totalMinutes),
      tone: "time",
      live: summary.totalMinutes > 0,
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
    {
      label: "Meetings",
      value: String(summary.meetings.length),
      tone: "met",
      live: summary.meetings.length > 0,
    },
  ];

  return (
    <RecordCard title="What the day held" badge="filled in by itself" measures={measures}>
      {summary.worked.length > 0 && (
        <section>
          <Strand tone="time">Worked on</Strand>
          <ul className="space-y-1">
            {summary.worked.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 text-sm">
                <span className="text-slate-700">{t.title}</span>
                {t.is_additional && (
                  <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800">
                    extra
                  </span>
                )}
                {t.project_name && (
                  <span className="text-xs text-slate-500">{t.project_name}</span>
                )}
                <span className="figure ml-auto shrink-0 text-sm font-medium text-slate-700">
                  {formatMinutes(t.minutes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.completed.length > 0 && (
        <section>
          <Strand tone="done">Finished</Strand>
          <ul className="space-y-1">
            {summary.completed.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 text-sm text-slate-700">
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
        </section>
      )}

      {summary.extra.length > 0 && (
        <section className="rounded-xl bg-violet-50 p-3 ring-1 ring-violet-200">
          <Strand tone="extra">Extra work that came in</Strand>
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
          <p className="mt-2 text-xs text-violet-900">
            Follow-up work raised after something was already finished — nobody planned
            this at the start of the day.
          </p>
        </section>
      )}

      {summary.meetings.length > 0 && (
        <section>
          <Strand tone="met">Meetings</Strand>
          <ul className="space-y-1">
            {summary.meetings.map((m, i) => (
              <li
                key={`${m.at}-${i}`}
                className="flex items-baseline gap-3 text-sm text-slate-700"
              >
                <span className="figure shrink-0 text-slate-600">{m.at}</span>
                {m.title}
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.comments > 0 && (
        <p className="text-sm text-slate-600">
          {summary.comments} comment{summary.comments === 1 ? "" : "s"} written.
        </p>
      )}
    </RecordCard>
  );
}
