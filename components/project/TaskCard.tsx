"use client";

import { TaskPriorityBadge } from "@/components/Badge";
import LabelChip from "@/components/LabelChip";
import Avatar from "@/components/Avatar";
import { formatDate, isOverdue } from "@/lib/format";
import type { Task } from "@/lib/types";

export default function TaskCard({
  task,
  onOpen,
  onDragStart,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  onDragStart: (id: number) => void;
}) {
  const overdue = isOverdue(task.due_date, task.status);
  const subTotal = task.subtask_total ?? 0;
  const subDone = task.subtask_done ?? 0;

  return (
    <div
      draggable
      onDragStart={() => onDragStart(task.id)}
      onClick={() => onOpen(task)}
      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-indigo-300 hover:shadow"
    >
      {task.labels && task.labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <LabelChip key={l.id} name={l.name} color={l.color} />
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">{task.title}</p>
        <TaskPriorityBadge priority={task.priority} />
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <div className="flex min-w-0 items-center gap-1.5">
          {task.assignee_name ? (
            <>
              <Avatar name={task.assignee_name} size="sm" />
              <span className="truncate">{task.assignee_name}</span>
            </>
          ) : (
            <span className="text-slate-400">Unassigned</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {subTotal > 0 && (
            <span className={subDone === subTotal ? "text-green-600" : ""}>
              ☑ {subDone}/{subTotal}
            </span>
          )}
          {(task.comment_count ?? 0) > 0 && (
            <span className="text-slate-400">💬 {task.comment_count}</span>
          )}
          {task.due_date && (
            <span className={overdue ? "font-medium text-red-600" : ""}>
              {formatDate(task.due_date)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
