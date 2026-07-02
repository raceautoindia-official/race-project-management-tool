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

export default function MyTasksView({ tasks }: { tasks: Task[] }) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "calendar">("list");

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

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400">
          You have no assigned tasks.
        </div>
      ) : view === "calendar" ? (
        <Calendar
          tasks={tasks}
          onSelect={(t) => router.push(`/projects/${t.project_id}`)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {TASK_STATUSES.map((status) => (
            <SectionCard
              key={status}
              title={`${TASK_STATUS_LABELS[status]} (${byStatus[status].length})`}
            >
              {byStatus[status].length === 0 ? (
                <p className="text-sm text-slate-400">Nothing here.</p>
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
                        <div className="flex items-center gap-2 text-xs text-slate-400">
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
                                : "text-slate-500"
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
    </div>
  );
}
