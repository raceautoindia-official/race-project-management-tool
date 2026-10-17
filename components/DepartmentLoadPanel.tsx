import Link from "next/link";
import { departmentTone } from "@/lib/department-colour";
import type { DepartmentLoad } from "@/lib/dashboard";

/**
 * The company's work, split by the department carrying it.
 *
 * Open tasks is the figure that matters here — it is the backlog each
 * department is holding. Overdue sits beside it and is only coloured when
 * there is something to colour, the same rule the rest of the dashboard uses.
 */
export default function DepartmentLoadPanel({ rows }: { rows: DepartmentLoad[] }) {
  if (rows.length === 0) return null;
  const busiest = Math.max(...rows.map((r) => r.open_tasks), 1);

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">By department</h2>
        <span className="text-sm text-slate-600">open tasks</span>
      </div>

      <ul className="mt-4 space-y-3">
        {rows.map((r) => {
          const name = r.department || "No department";
          return (
            <li key={name}>
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={`/projects?department=${encodeURIComponent(
                    r.department || "none"
                  )}`}
                  className="inline-block min-h-[1.75rem] truncate py-1 text-sm font-medium text-slate-800 hover:text-indigo-600 hover:underline"
                >
                  {name}
                </Link>
                <span className="flex shrink-0 items-baseline gap-3 text-sm">
                  {r.overdue > 0 && (
                    <span className="text-rose-600">
                      <span className="figure font-semibold">{r.overdue}</span> late
                    </span>
                  )}
                  <span className="figure text-base font-semibold text-slate-900">
                    {r.open_tasks}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full ${departmentTone(name).bar}`}
                  style={{ width: `${Math.round((r.open_tasks / busiest) * 100)}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {r.projects} {r.projects === 1 ? "project" : "projects"} ·{" "}
                {r.people} {r.people === 1 ? "person" : "people"}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
