/**
 * Where a task is on its way, as five steps everyone can read the same way:
 *
 *   To do → In progress → In review → Approved → Signed off
 *
 * "Approved" is the status the app stores as Done (a lead approved the
 * finished work); "Signed off" is the last check, after which the task is
 * locked. Finished steps are ticked, the current one is highlighted and says
 * who acts next.
 */

const STEPS = ["To do", "In progress", "In review", "Approved", "Signed off"] as const;

export function taskStepIndex(status: string, signedOff: boolean): number {
  if (signedOff) return 4;
  return status === "done" ? 3 : status === "review" ? 2 : status === "in_progress" ? 1 : 0;
}

export default function TaskSteps({
  status,
  signedOff,
  next,
  className = "",
}: {
  status: "todo" | "in_progress" | "review" | "done";
  signedOff: boolean;
  /** Who acts next, in a few words ("Sam approves each subtask"). */
  next?: string | null;
  className?: string;
}) {
  const at = taskStepIndex(status, signedOff);
  return (
    <div className={className}>
      <ol className="flex flex-wrap items-center gap-y-1.5 text-xs" aria-label={`Step ${at + 1} of 5: ${STEPS[at]}`}>
        {STEPS.map((label, i) => {
          const done = i < at || (i === 4 && signedOff);
          const current = i === at && !done;
          return (
            <li key={label} className="flex items-center" aria-current={current ? "step" : undefined}>
              {i > 0 && <span aria-hidden className={`mx-1.5 h-px w-4 sm:w-6 ${i <= at ? "bg-emerald-400" : "bg-slate-300"}`} />}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${
                  done
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                    : current
                      ? "bg-indigo-600 text-white ring-indigo-600"
                      : "bg-white text-slate-500 ring-slate-200"
                }`}
              >
                <span aria-hidden>{done ? "✓" : i + 1}</span>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      {next && !signedOff && (
        <p className="mt-1.5 text-xs text-slate-600">
          <span className="font-medium text-slate-700">Next:</span> {next}
        </p>
      )}
    </div>
  );
}
