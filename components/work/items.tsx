import Link from "next/link";
import { formatIst } from "@/lib/tz";
import { formatRelative } from "@/lib/format";
import type { Attention, WorkItem } from "@/lib/my-work";

/**
 * components/work/items.tsx — small server-safe pieces shared by My Work and
 * Reviews: where an item lives, its "project › task" trail, page tabs and the
 * meetings list.
 */

/** The task page, opened on the subtask when it is one. */
export function itemHref(i: Pick<WorkItem, "kind" | "id" | "task_id" | "project_id">): string {
  return i.kind === "subtask"
    ? `/projects/${i.project_id}/tasks/${i.task_id}?subtask=${i.id}`
    : `/projects/${i.project_id}/tasks/${i.id}`;
}

/** "3 hours ago" for a UTC "YYYY-MM-DD HH:MM:SS" stamp from the database. */
export function utcAgo(at: string | null | undefined): string {
  if (!at) return "";
  const s = String(at);
  return formatRelative(s.length > 10 && !/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(" ", "T") + "Z" : s);
}

/** Project › task, each a link. For a task, only the project. */
export function ItemContext({ item }: { item: WorkItem }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-slate-500">
      <Link href={`/projects/${item.project_id}`} className="truncate hover:text-indigo-700 hover:underline">
        {item.project_name}
      </Link>
      {item.kind === "subtask" && (
        <>
          <span aria-hidden>›</span>
          <Link href={`/projects/${item.project_id}/tasks/${item.task_id}`} className="truncate hover:text-indigo-700 hover:underline">
            {item.task_title}
          </Link>
        </>
      )}
    </span>
  );
}

export const ATTENTION_LABELS: Record<Attention["kind"], { icon: string; label: string; action: string }> = {
  signoff: { icon: "✍", label: "Ready for your sign-off", action: "Sign off" },
  project_request: { icon: "▢", label: "New project request", action: "Review request" },
  task_request: { icon: "＋", label: "Task request", action: "Review request" },
  blocker: { icon: "⛔", label: "Blocker request", action: "Open task" },
};

/** One item from the existing workflows (sign-offs, requests, blockers). */
export function AttentionRow({ a }: { a: Attention }) {
  const l = ATTENTION_LABELS[a.kind];
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-700" aria-hidden>
        {l.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-500">{l.label}</p>
        <Link href={a.link} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">
          {a.title}
        </Link>
        <p className="text-xs text-slate-500">
          {a.kind !== "project_request" && <>{a.project_name} · </>}
          {a.who ? `from ${a.who}` : ""}
          {a.at ? ` · ${utcAgo(a.at)}` : ""}
        </p>
      </div>
      <Link
        href={a.link}
        className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {l.action} →
      </Link>
    </li>
  );
}

/** Page-level tabs. They are links, so each tab has its own address. */
export function PageTabs({
  tabs,
  active,
  label,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 mb-6 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-1 border-b border-slate-200">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  on ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span
                    className={`figure rounded-full px-1.5 py-0.5 text-xs ${
                      on ? "bg-indigo-100 text-indigo-700" : t.count > 0 ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface MeetingRow {
  id: number;
  title: string;
  start_time: string;
  project_name: string | null;
}

export function MeetingList({ meetings }: { meetings: MeetingRow[] }) {
  if (meetings.length === 0) return <p className="text-sm text-slate-500">No upcoming meetings.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {meetings.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-2 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-800">{m.title}</div>
            {m.project_name && <div className="text-xs text-slate-500">{m.project_name}</div>}
          </div>
          <span className="shrink-0 text-xs font-medium text-indigo-600">{formatIst(String(m.start_time))}</span>
        </li>
      ))}
    </ul>
  );
}
