import PageBand from "@/components/PageBand";

/**
 * The three shapes every page is built from.
 *
 * A page opens with one bold thing — the header band — and everything under
 * it stays quiet: hairlines, one radius, no shadow. Depth comes from the
 * band and the rail, not from a grey blur under each card.
 */

/** The accents a tile can take. Each one means a state, not a mood. */
const TILE_ACCENTS = {
  neutral: "bg-white ring-slate-200",
  running: "bg-indigo-50 ring-indigo-200",
  review: "bg-amber-50 ring-amber-200",
  done: "bg-emerald-50 ring-emerald-200",
  flag: "bg-rose-50 ring-rose-200",
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
    <div className={`rounded-2xl p-5 ring-1 ${TILE_ACCENTS[tone]}`}>
      <div className="text-sm font-medium text-slate-600">{label}</div>
      <div className={`figure mt-2 text-3xl font-semibold ${accent}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
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
    <div
      className={`overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 bg-slate-50 px-5 py-3">
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
export function PageHeader(props: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** The numbers that matter here, read left to right. */
  figures?: { label: string; value: React.ReactNode }[];
}) {
  return <PageBand {...props} />;
}
