/**
 * The three shapes every page is built from.
 *
 * A page opens with one bold thing — the header band — and everything under
 * it stays quiet: hairlines, one radius, no shadow. Depth comes from the
 * band and the rail, not from a grey blur under each card.
 */

/** The accents a tile can take. Each one means a state, not a mood. */
const TILE_ACCENTS = {
  neutral: "bg-slate-200",
  running: "bg-indigo-600",
  review: "bg-amber-500",
  done: "bg-green-600",
  flag: "bg-red-500",
} as const;

export type TileAccent = keyof typeof TILE_ACCENTS;

export function StatCard({
  label,
  value,
  hint,
  accent = "text-slate-900",
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  /** Kept for the pages that colour their own figure. */
  accent?: string;
  tone?: TileAccent;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className={`h-1 ${TILE_ACCENTS[tone]}`} />
      <div className="p-5">
        <div className="text-sm font-medium text-slate-600">{label}</div>
        <div className={`figure mt-2 text-3xl font-semibold ${accent}`}>{value}</div>
        {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/**
 * The band. One per page, dark, with the page's name, what it is for, and
 * the action that belongs to it — then a signal rule under it so the eye
 * knows where the page proper starts.
 */
export function PageHeader({
  title,
  subtitle,
  action,
  figures,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** The numbers that matter here, read left to right. */
  figures?: { label: string; value: React.ReactNode }[];
}) {
  return (
    <div className="mb-6 overflow-hidden rounded-lg bg-slate-900 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{title}</h1>
          {subtitle && (
            <p className="mt-1 max-w-[65ch] text-sm text-slate-300">{subtitle}</p>
          )}
        </div>
        {action}
      </div>

      {figures && figures.length > 0 && (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-white/10 px-5 py-3 sm:px-6">
          {figures.map((f) => (
            <div key={f.label}>
              <dt className="text-xs font-medium text-slate-400">{f.label}</dt>
              <dd className="figure text-lg font-semibold text-white">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="h-1 bg-indigo-600" />
    </div>
  );
}
