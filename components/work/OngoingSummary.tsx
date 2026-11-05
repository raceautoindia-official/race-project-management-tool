import { ONGOING_WINDOW_DAYS, onTimePercent, type OngoingStats } from "@/lib/progress";

/**
 * How an ongoing project (only recurring work, lib/progress.ts) reads in
 * place of a progress bar: the share of its copies done on time lately.
 */

export function OngoingBadge() {
  return (
    <span
      title="Only recurring work — it doesn't finish, so it's measured by copies done on time"
      className="inline-flex items-center whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200"
    >
      ↻ Ongoing
    </span>
  );
}

function tone(pct: number | null) {
  if (pct === null) return { bar: "bg-slate-300", text: "text-slate-500" };
  return pct >= 90
    ? { bar: "bg-emerald-500", text: "text-emerald-700" }
    : pct >= 70
      ? { bar: "bg-amber-500", text: "text-amber-700" }
      : { bar: "bg-red-500", text: "text-red-700" };
}

export default function OngoingSummary({
  stats,
  variant = "card",
  className = "",
}: {
  stats: OngoingStats;
  /** card: figure, words and a bar; inline: one short line. */
  variant?: "card" | "inline";
  className?: string;
}) {
  const pct = onTimePercent(stats);
  const t = tone(pct);
  const words = stats.done
    ? `${stats.onTime} of ${stats.done} cop${stats.done === 1 ? "y" : "ies"} on time · last ${ONGOING_WINDOW_DAYS} days`
    : `No copies finished in the last ${ONGOING_WINDOW_DAYS} days`;
  if (variant === "inline") {
    return (
      <span className={`text-xs text-slate-600 ${className}`} title={words}>
        <span className={`figure font-semibold ${t.text}`}>{pct === null ? "—" : `${pct}%`}</span> on time
      </span>
    );
  }
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 text-xs text-slate-600">
        <span>
          <span className={`figure text-lg font-bold ${pct === null ? "text-slate-400" : "text-slate-900"}`}>{pct === null ? "—" : `${pct}%`}</span> on time
        </span>
        <span className="text-slate-500">{words}</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={pct === null ? words : `${pct}% of recurring copies done on time`}
      >
        <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}
