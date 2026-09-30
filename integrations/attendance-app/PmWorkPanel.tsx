/**
 * "Your work today" panel for the Attendance app's check-in screen.
 *
 * Copy this file into the Attendance app. It takes data and renders it —
 * it fetches nothing — so it works in either Next.js router, and in a
 * client component if the data was fetched on the server and passed down.
 *
 * Renders nothing at all when there is no work to show. An empty box saying
 * "no tasks" on a screen people open every morning is just clutter.
 */
import type { PmWork } from "./pm-work";
import { formatMinutes } from "./pm-work";

const PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-slate-100 text-slate-700",
  low: "bg-slate-100 text-slate-600",
};

export default function PmWorkPanel({ work }: { work: PmWork }) {
  if (!work.known || work.openCount === 0) return null;

  return (
    <section
      aria-label="Your work in PM App"
      className="rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Your work today</h2>
        {work.url && (
          <a
            href={work.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            Open PM App →
          </a>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <span className="text-slate-700">
          <strong className="text-slate-900">{work.openCount}</strong> open
        </span>
        {work.dueTodayCount > 0 && (
          <span className="text-slate-700">
            <strong className="text-slate-900">{work.dueTodayCount}</strong> due today
          </span>
        )}
        {work.overdueCount > 0 && (
          <span className="font-medium text-red-700">{work.overdueCount} overdue</span>
        )}
        <span className="text-slate-600">
          {formatMinutes(work.loggedTodayMinutes)} logged today
        </span>
      </div>

      <ul className="divide-y divide-slate-100">
        {work.tasks.slice(0, 5).map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <a
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-600"
              >
                {t.title}
              </a>
              <span className="text-xs text-slate-600">{t.project}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.medium
                }`}
              >
                {t.priority}
              </span>
              {t.dueDate && (
                <span
                  className={`text-xs ${
                    t.overdue ? "font-medium text-red-600" : "text-slate-600"
                  }`}
                >
                  {new Date(`${t.dueDate}T00:00:00Z`).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {work.tasks.length > 5 && (
        <p className="mt-2 text-xs text-slate-600">
          and {work.tasks.length - 5} more
        </p>
      )}
    </section>
  );
}
