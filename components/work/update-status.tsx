import type { UpdateStatus } from "@/lib/planner";

/** How each work-update status looks, everywhere it is shown. */
export const UPDATE_STATUS: Record<UpdateStatus, { label: string; cell: string; badge: string }> = {
  submitted: { label: "Submitted", cell: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  auto: { label: "Auto-submitted", cell: "bg-sky-400", badge: "bg-sky-100 text-sky-800 ring-sky-200" },
  draft: { label: "Draft, not submitted", cell: "bg-amber-300", badge: "bg-amber-100 text-amber-900 ring-amber-200" },
  due: { label: "Due today", cell: "bg-white ring-2 ring-inset ring-amber-400", badge: "bg-amber-50 text-amber-800 ring-amber-200" },
  missing: { label: "Missing", cell: "bg-rose-500", badge: "bg-rose-100 text-rose-800 ring-rose-200" },
  upcoming: { label: "Upcoming", cell: "bg-slate-100", badge: "bg-slate-100 text-slate-600 ring-slate-200" },
  off: { label: "Sunday — not due", cell: "bg-slate-200/60", badge: "bg-slate-100 text-slate-500 ring-slate-200" },
  untracked: {
    label: "Before submitting began",
    cell: "bg-[repeating-linear-gradient(45deg,#f1f5f9_0_4px,#e2e8f0_4px_8px)]",
    badge: "bg-slate-100 text-slate-500 ring-slate-200",
  },
};

/** A week's update is due all week, not today. */
export function UpdateStatusBadge({ status, period = "day" }: { status: UpdateStatus; period?: "day" | "week" }) {
  const s = UPDATE_STATUS[status];
  const label = period === "week" && status === "due" ? "Due this week" : s.label;
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.badge}`}>
      {label}
    </span>
  );
}

/** The key under a grid of status cells. */
export function UpdateStatusLegend() {
  const shown: UpdateStatus[] = ["submitted", "auto", "draft", "due", "missing", "off", "untracked"];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {shown.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded ${UPDATE_STATUS[k].cell}`} aria-hidden />
          {UPDATE_STATUS[k].label}
        </li>
      ))}
    </ul>
  );
}
