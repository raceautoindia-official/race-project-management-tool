"use client";

/**
 * The project's default view: each task with its owner, dates, weight and
 * approved progress, expanding into its subtasks (the same SubtasksPanel as
 * the task page). Owners click a weight to change it.
 */

import Link from "next/link";
import { useState } from "react";
import { TaskStatusBadge } from "@/components/Badge";
import { isOverdue } from "@/lib/format";
import { effectiveWeights } from "@/lib/work-engine";
import type { Task } from "@/lib/types";
import SubtasksPanel from "./SubtasksPanel";
import { DateRange, PersonLine, WeightChip, WeightEditor, WorkProgress, type PickPerson } from "./kit";

type Filter = "all" | "mine" | "review" | "overdue";

const COLS = "lg:grid-cols-[minmax(0,1fr)_180px_120px_76px_160px]";

export default function ProjectTree({
  projectId,
  projectName,
  tasks,
  people,
  currentUser,
  isManager,
  writable,
  onOpen,
  onTaskChanged,
  onWeightsSaved,
}: {
  projectId: number;
  projectName: string;
  tasks: Task[];
  people: PickPerson[];
  currentUser: { id: number; role: "admin" | "member" };
  isManager: boolean;
  writable: boolean;
  /** Quick view in the board's task dialog. */
  onOpen: (task: Task) => void;
  /** Re-read one task (its status or progress moved). */
  onTaskChanged: (taskId: number) => void;
  onWeightsSaved: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [weightsOpen, setWeightsOpen] = useState(false);

  const weights = effectiveWeights(
    tasks.map((t) => ({ id: t.id, weight: Number(t.weight ?? 0), weight_mode: t.weight_mode === "manual" ? "manual" : "auto" }))
  );
  const mayWeigh = isManager && writable && tasks.length > 1;
  const sorted = [...tasks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
  const visible = sorted.filter((t) => {
    if (filter === "mine") return t.assignee_id === currentUser.id;
    if (filter === "review") return t.status === "review" || Number(t.progress_pending ?? 0) > 0;
    if (filter === "overdue") return isOverdue(t.due_date, t.status);
    return true;
  });
  const person = (id: number | null) => people.find((p) => p.user_id === id);
  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-xs" role="group" aria-label="Show">
          {([
            ["all", "Everything"],
            ["mine", "Mine"],
            ["review", "Waiting for review"],
            ["overdue", "Overdue"],
          ] as [Filter, string][]).map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={`rounded-md px-2.5 py-1 ${filter === k ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {l}
            </button>
          ))}
        </div>
        {mayWeigh && (
          <button type="button" onClick={() => setWeightsOpen(true)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            ⚖ Adjust task weights
          </button>
        )}
        <div className="ml-auto flex gap-2 text-xs">
          <button type="button" onClick={() => setOpen(new Set(tasks.map((t) => t.id)))} className="text-slate-500 hover:text-indigo-600">Expand all</button>
          <span className="text-slate-300">|</span>
          <button type="button" onClick={() => setOpen(new Set())} className="text-slate-500 hover:text-indigo-600">Collapse all</button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="font-medium text-slate-800">No tasks yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Break this project into tasks and give each one an owner. Weights are split evenly; you can adjust them later.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className={`hidden gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 lg:grid ${COLS}`}>
            <span>Task</span>
            <span>Owner</span>
            <span>Start → Due</span>
            <span title="Share of the project's progress">Weight</span>
            <span>Progress (approved)</span>
          </div>
          {visible.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing matches this filter.</p>}
          {visible.map((t) => {
            const w = weights.get(t.id) ?? 0;
            const expanded = open.has(t.id);
            const owner = person(t.assignee_id);
            const locked = Boolean(t.signed_off_at) || !writable;
            return (
              <div key={t.id} className="border-b border-slate-100 last:border-b-0">
                <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-slate-50/70 ${COLS}`}>
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggle(t.id)}
                      aria-expanded={expanded}
                      aria-label={expanded ? `Hide subtasks of ${t.title}` : `Show subtasks of ${t.title}`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                    >
                      <span className={`transition ${expanded ? "rotate-90" : ""}`}>▸</span>
                    </button>
                    <div className="min-w-0">
                      <button type="button" onClick={() => onOpen(t)} className="block max-w-full truncate text-left font-medium text-slate-900 hover:text-indigo-700">
                        {t.title}
                      </button>
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <TaskStatusBadge status={t.status} />
                        {t.signed_off_at && <span className="text-violet-700">🔒 Signed off</span>}
                        <span>
                          {Number(t.subtask_total ?? 0) > 0
                            ? `${t.subtask_done ?? 0}/${t.subtask_total} subtasks approved`
                            : "No subtasks — the owner does this one"}
                        </span>
                        <Link href={`/projects/${projectId}/tasks/${t.id}`} className="text-indigo-600 hover:underline">
                          Open page →
                        </Link>
                      </p>
                    </div>
                  </div>
                  <span className="lg:hidden" />
                  <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 lg:contents">
                    <PersonLine name={t.assignee_name} designation={owner?.designation} department={owner?.department} empty="No owner" />
                    <DateRange start={t.start_date} due={t.due_date} finished={t.status === "done"} notStarted={t.status === "todo"} />
                    <WeightChip value={w} canEdit={mayWeigh} onEdit={() => setWeightsOpen(true)} title={`Counts for this share of ${projectName}.`} />
                    <WorkProgress approved={t.status === "done" ? 100 : Number(t.progress_approved ?? 0)} pending={Number(t.progress_pending ?? 0)} showLabel label={`${t.title} progress`} className="min-w-32 flex-1 lg:flex-none" />
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 lg:pl-12">
                    <SubtasksPanel
                      task={{ id: t.id, project_id: t.project_id, title: t.title, status: t.status, assignee_id: t.assignee_id }}
                      currentUser={currentUser}
                      isManager={isManager}
                      people={people}
                      readOnly={locked}
                      compact
                      onTaskChanged={() => onTaskChanged(t.id)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <WeightEditor
        open={weightsOpen}
        onClose={() => setWeightsOpen(false)}
        parentLabel={projectName}
        endpoint={`/api/projects/${projectId}/tasks/weights`}
        onSaved={onWeightsSaved}
        items={sorted.map((t) => ({
          id: t.id,
          title: t.title,
          who: t.assignee_name ?? null,
          weight: weights.get(t.id) ?? 0,
          auto: t.weight_mode !== "manual",
        }))}
      />
    </div>
  );
}
