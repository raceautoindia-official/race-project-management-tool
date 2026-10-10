import Link from "next/link";

/**
 * What needs a person, and what merely is.
 *
 * A dashboard of six equal tiles makes "8 users" shout as loudly as "5
 * things are late". This splits them: the figures that want an answer are
 * large, coloured and clickable; the ones that are just facts sit quietly
 * beside them.
 */

export interface AttentionItem {
  label: string;
  value: number;
  href: string;
  /** What to call it when there is nothing to do. */
  clear: string;
  tone: "danger" | "warn";
}

const TONES = {
  danger: {
    live: "bg-rose-500 text-white ring-rose-500",
    figure: "text-rose-600",
    rule: "bg-rose-500",
  },
  warn: {
    live: "bg-amber-500 text-white ring-amber-500",
    figure: "text-amber-600",
    rule: "bg-amber-500",
  },
} as const;

export function AttentionPanel({
  items,
  children,
}: {
  items: AttentionItem[];
  /** What is actually late, under the figures. */
  children?: React.ReactNode;
}) {
  const quiet = items.every((i) => i.value === 0);

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-3 px-6 pt-5">
        <h2 className="text-lg font-semibold text-slate-900">Needs attention</h2>
        {quiet && (
          <span className="text-sm font-medium text-emerald-600">All clear</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-3">
        {items.map((item) => {
          const tone = TONES[item.tone];
          const live = item.value > 0;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="group bg-white px-6 py-5 transition hover:bg-slate-50"
            >
              <div
                className={`figure text-5xl font-semibold tabular-nums ${
                  live ? tone.figure : "text-slate-500"
                }`}
              >
                {item.value}
              </div>
              <div className="mt-1 text-sm font-medium text-slate-700">
                {live ? item.label : item.clear}
              </div>
              <div
                className={`mt-3 h-1 w-10 rounded-full ${live ? tone.rule : "bg-slate-200"}`}
              />
            </Link>
          );
        })}
      </div>

      {children && <div className="border-t border-slate-100 px-6 py-4">{children}</div>}
    </section>
  );
}

/** The quiet figures: counts that are facts, not requests. */
export function GlanceList({
  items,
}: {
  items: { label: string; value: React.ReactNode; hint?: string }[];
}) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold text-slate-900">At a glance</h2>
      <dl className="mt-3 divide-y divide-slate-100">
        {items.map((i) => (
          <div key={i.label} className="flex items-baseline justify-between py-2.5">
            <dt className="text-sm text-slate-600">
              {i.label}
              {i.hint && <span className="ml-1.5 text-xs text-slate-500">{i.hint}</span>}
            </dt>
            <dd className="figure text-xl font-semibold text-slate-900">{i.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
