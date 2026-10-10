"use client";

/**
 * The parts of the planner that nobody fills in.
 *
 * The day and the week are both records: hours logged, tasks finished, work
 * that arrived uninvited. They are written as people work, not typed into a
 * form, and they read differently from the box underneath because they are a
 * different kind of thing — warm paper, figures in a line, nothing to edit.
 *
 * Both panels share this so they cannot drift apart on the same screen.
 */

/** Each measure keeps its colour wherever it appears in the planner. */
export const TONES = {
  time: { figure: "text-amber-700", rule: "bg-amber-500", dot: "text-amber-600" },
  done: { figure: "text-emerald-700", rule: "bg-emerald-500", dot: "text-emerald-600" },
  extra: { figure: "text-violet-700", rule: "bg-violet-500", dot: "text-violet-600" },
  met: { figure: "text-sky-700", rule: "bg-sky-500", dot: "text-sky-600" },
  span: { figure: "text-indigo-700", rule: "bg-indigo-500", dot: "text-indigo-600" },
} as const;

export type Tone = keyof typeof TONES;

export interface MeasureItem {
  label: string;
  value: string;
  tone: Tone;
  /** Coloured when there is something to say, grey when there is not. */
  live: boolean;
}

/** A heading for one strand of the record, marked in that strand's colour. */
export function Strand({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-800">
      <span aria-hidden="true" className={`text-xs ${TONES[tone].dot}`}>
        ●
      </span>
      {children}
    </h3>
  );
}

/** Nothing happened yet, said without alarm. */
export function EmptyRecord({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-6 text-center text-sm text-slate-600">
      {children}
    </p>
  );
}

export function RecordCard({
  title,
  badge,
  measures,
  children,
}: {
  title: string;
  /** Why this is here without anyone typing it. */
  badge: string;
  measures: MeasureItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-b from-amber-50 to-white ring-1 ring-amber-200">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          {badge}
        </span>
      </div>

      {/* The hairlines between the figures are the gap showing through, so
          the band runs edge to edge rather than sitting in an inset frame. */}
      <dl className="mt-3 grid grid-cols-2 gap-px border-y border-amber-200 bg-amber-200/60 sm:grid-cols-4">
        {measures.map((m) => {
          const t = TONES[m.tone];
          return (
            <div key={m.label} className="bg-white/70 px-4 py-3">
              <dd
                className={`figure text-3xl font-semibold ${
                  m.live ? t.figure : "text-slate-500"
                }`}
              >
                {m.value}
              </dd>
              <div
                className={`mt-2 h-1 w-8 rounded-full ${m.live ? t.rule : "bg-slate-200"}`}
              />
              <dt className="mt-2 text-sm text-slate-600">{m.label}</dt>
            </div>
          );
        })}
      </dl>

      <div className="space-y-4 bg-white px-5 py-4">{children}</div>
    </div>
  );
}
