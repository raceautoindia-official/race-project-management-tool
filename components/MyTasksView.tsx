"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TaskPriorityBadge } from "@/components/Badge";
import LabelChip from "@/components/LabelChip";
import Calendar from "@/components/Calendar";
import { SectionCard } from "@/components/Cards";
import { formatDate, isOverdue } from "@/lib/format";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type Task,
  type TaskStatus,
} from "@/lib/types";

export default function MyTasksView({
  tasks,
  projectTasks = [],
}: {
  tasks: Task[];
  /** Live work owned by other people on the projects you belong to. */
  projectTasks?: Task[];
}) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "calendar">("list");
  // The calendar is about dates, so it shows the whole picture — your work
  // and everything else due on your projects.
  const calendarTasks = [...tasks, ...projectTasks];

  const byStatus: Record<TaskStatus, Task[]> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
  };
  for (const t of tasks) byStatus[t.status].push(t);

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {(["list", "calendar"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1.5 font-medium capitalize ${
              view === v ? "bg-indigo-600 text-white" : "text-slate-600"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Someone who picks Calendar gets a calendar, even with nothing in it.
          Swapping it for a line of text reads as a broken page. */}
      {view === "calendar" ? (
        <>
          <Calendar
            tasks={calendarTasks}
            onSelect={(t) => router.push(`/projects/${t.project_id}`)}
          />
          {calendarTasks.length === 0 && (
            <p className="mt-3 text-center text-sm text-slate-600">
              Nothing is due on your projects yet, so there is nothing on the calendar.
            </p>
          )}
        </>
      ) : tasks.length === 0 && projectTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
          You have no assigned tasks, and nothing is live on your projects yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {TASK_STATUSES.map((status) => (
            <SectionCard
              key={status}
              title={`${TASK_STATUS_LABELS[status]} (${byStatus[status].length})`}
            >
              {byStatus[status].length === 0 ? (
                <p className="text-sm text-slate-500">Nothing here.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {byStatus[status].map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${t.project_id}`}
                          className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-600"
                        >
                          {t.title}
                        </Link>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>{t.project_name}</span>
                          {t.labels?.map((l) => (
                            <LabelChip key={l.id} name={l.name} color={l.color} />
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <TaskPriorityBadge priority={t.priority} />
                        {t.due_date && (
                          <span
                            className={`text-xs ${
                              isOverdue(t.due_date, t.status)
                                ? "font-medium text-red-600"
                                : "text-slate-600"
                            }`}
                          >
                            {formatDate(t.due_date)}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          ))}
        </div>
      )}

      {/* What else is live around you. Your own work stays above, on its own,
          so this never buries the thing you are accountable for. */}
      {view === "list" && projectTasks.length > 0 && (
        <div className="mt-6">
          <SectionCard title={`Active on my projects (${projectTasks.length})`}>
            <ul className="divide-y divide-slate-100">
              {projectTasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link
                      href={`/projects/${t.project_id}`}
                      className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-600"
                    >
                      {t.title}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span>{t.project_name}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t.assignee_name ? `Owner: ${t.assignee_name}` : "No owner yet"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{TASK_STATUS_LABELS[t.status]}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <TaskPriorityBadge priority={t.priority} />
                    {t.due_date && (
                      <span
                        className={`text-xs ${
                          isOverdue(t.due_date, t.status)
                            ? "font-medium text-red-600"
                            : "text-slate-600"
                        }`}
                      >
                        {formatDate(t.due_date)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
