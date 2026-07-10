import Link from "next/link";
import { ProgressBar } from "@/components/ProgressBar";
import type { ProjectProgress } from "@/lib/dashboard";

type Tone = "default" | "warn" | "danger" | "good";

const TONE_INK: Record<Tone, string> = {
  default: "text-slate-900",
  warn: "text-amber-600",
  danger: "text-red-600",
  good: "text-green-600",
};

/** A KPI stat tile, optionally a link, with a tone that only "lights up" a
 *  metric that needs attention (non-zero overdue/outstanding). */
export function KpiTile({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  href?: string;
  tone?: Tone;
}) {
  const inner = (
    <div className="h-full rounded-xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${TONE_INK[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** Horizontal completion bars for the busiest projects (magnitude → one hue). */
export function ProjectProgressList({
  projects,
}: {
  projects: ProjectProgress[];
}) {
  if (projects.length === 0) {
    return <p className="text-sm text-slate-400">No active projects yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {projects.map((p) => {
        const total = Number(p.task_count);
        const done = Number(p.done_count);
        const pct = total ? Math.round((done / total) * 100) : 0;
        return (
          <li key={p.id}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <Link
                href={`/projects/${p.id}`}
                className="truncate font-medium text-slate-700 hover:text-indigo-600"
              >
                {p.name}
              </Link>
              <span className="shrink-0 text-xs text-slate-500">
                {done}/{total}
                <span className="ml-1 font-medium text-slate-700">{pct}%</span>
              </span>
            </div>
            <ProgressBar value={pct} tone={pct === 100 ? "green" : "indigo"} />
          </li>
        );
      })}
    </ul>
  );
}

/** Estimated vs. logged hours as a single meter. */
export function HoursMeter({
  estimated,
  spent,
}: {
  estimated: number;
  spent: number;
}) {
  const est = Number(estimated) || 0;
  const sp = Number(spent) || 0;
  const pct = est > 0 ? Math.round((sp / est) * 100) : 0;
  const over = est > 0 && sp > est;
  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-3xl font-bold text-slate-900">{sp}h</div>
          <div className="text-xs text-slate-400">
            logged{est > 0 ? ` of ${est}h estimated` : " (no estimates set)"}
          </div>
        </div>
        {est > 0 && (
          <div
            className={`text-sm font-medium ${
              over ? "text-amber-600" : "text-slate-500"
            }`}
          >
            {pct}%
          </div>
        )}
      </div>
      {est > 0 && (
        <div className="mt-2">
          <ProgressBar value={Math.min(pct, 100)} tone={over ? "green" : "indigo"} />
          {over && (
            <p className="mt-1 text-xs text-amber-600">
              Over estimate by {sp - est}h
            </p>
          )}
        </div>
      )}
    </div>
  );
}
