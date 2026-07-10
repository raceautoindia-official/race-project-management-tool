import type { TaskStatus } from "@/lib/types";

/** A simple single-value completion bar. */
export function ProgressBar({
  value,
  tone = "indigo",
  className = "",
}: {
  value: number;
  tone?: "indigo" | "green";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const bar = tone === "green" ? "bg-green-500" : "bg-indigo-500";
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full ${bar} transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const SEGMENTS: { key: TaskStatus; color: string; label: string }[] = [
  { key: "todo", color: "bg-slate-300", label: "To Do" },
  { key: "in_progress", color: "bg-blue-400", label: "In Progress" },
  { key: "review", color: "bg-amber-400", label: "Review" },
  { key: "done", color: "bg-green-500", label: "Done" },
];

/** A segmented bar showing the proportion of tasks in each status, + legend. */
export function StatusBar({
  counts,
  showLegend = true,
}: {
  counts: Record<TaskStatus, number>;
  showLegend?: boolean;
}) {
  const total = SEGMENTS.reduce((sum, s) => sum + (counts[s.key] ?? 0), 0);
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
        {total > 0 &&
          SEGMENTS.map((s) => {
            const w = ((counts[s.key] ?? 0) / total) * 100;
            return w > 0 ? (
              <div
                key={s.key}
                className={s.color}
                style={{ width: `${w}%` }}
                title={`${s.label}: ${counts[s.key]}`}
              />
            ) : null;
          })}
      </div>
      {showLegend && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-sm ${s.color}`} />
              {s.label} {counts[s.key] ?? 0}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
