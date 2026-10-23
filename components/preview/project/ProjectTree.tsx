"use client";

// The default project view: tasks as rows that expand into their subtasks, so
// owner → assignee, dates, expected vs actual hours, weight and progress
// roll-up are visible in one place. Owners click a weight to adjust it.

import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { usePreview } from "@/lib/preview/store";
import {
  can,
  effectiveWeights,
  isOverdue,
  itemLink,
  subtasksOf,
  taskProgress,
  tasksOf,
  weightLabel,
} from "@/lib/preview/engine";
import type { Project, WorkItem } from "@/lib/preview/types";
import { DateRange, EmptyState, PersonChip, ProgressBar, StatusPill, Button } from "../ui";
import { AddItemRow, WeightCell, WeightEditor, WorkActions } from "../work";
import { HoursBadge } from "../ItemPanels";

type Filter = "all" | "mine" | "review" | "overdue";

// One grid template for headings, task rows and subtask rows (desktop).
const COLS = "lg:grid-cols-[minmax(0,1fr)_170px_120px_96px_86px_150px]";

export default function ProjectTree({ project }: { project: Project }) {
  const { state, me, terms, addTask } = usePreview();
  const { toast } = useToast();
  const tasks = tasksOf(state, project.id);
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);
  const [adding, setAdding] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);

  const canCreateTask = can(state, me.id, "task.create", { project });
  const canTaskWeights = can(state, me.id, "task.weights", { project });
  const members = [project.ownerId, ...project.memberIds];
  const weights = effectiveWeights(tasks);
  const liveTasks = tasks.filter((t) => t.status !== "cancelled");

  const matches = (i: WorkItem): boolean => {
    if (filter === "mine") return i.personId === me.id;
    if (filter === "review") return i.status === "in_review";
    if (filter === "overdue") return isOverdue(i);
    return true;
  };
  const visibleTasks = tasks.filter((t) => {
    if (t.status === "cancelled" && !showCancelled) return false;
    if (filter === "all") return true;
    return matches(t) || subtasksOf(state, t.id).some(matches);
  });
  const cancelledCount = tasks.length - liveTasks.length;

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
          {([
            ["all", "Everything"],
            ["mine", "Mine"],
            ["review", "Waiting for review"],
            ["overdue", "Overdue"],
          ] as [Filter, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 ${filter === k ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
        {canTaskWeights && liveTasks.length > 1 && (
          <Button size="sm" variant="secondary" onClick={() => setWeightsOpen(true)}>⚖ Adjust {terms.task.one.toLowerCase()} weights</Button>
        )}
        <div className="ml-auto flex gap-2 text-xs">
          <button onClick={() => setCollapsed(new Set())} className="text-slate-500 hover:text-indigo-600">Expand all</button>
          <span className="text-slate-300">|</span>
          <button onClick={() => setCollapsed(new Set(tasks.map((t) => t.id)))} className="text-slate-500 hover:text-indigo-600">Collapse all</button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon="🧩"
          title={`No ${terms.task.many.toLowerCase()} yet`}
          body={canCreateTask
            ? `Break this ${terms.project.one.toLowerCase()} into ${terms.task.many.toLowerCase()}, each with an owner, dates and expected hours. Weights are split evenly, and you can adjust them later.`
            : `The ${terms.project.one.toLowerCase()} owner hasn't added any ${terms.task.many.toLowerCase()} yet.`}
          action={canCreateTask ? <Button onClick={() => setAdding(true)}>+ Add the first {terms.task.one.toLowerCase()}</Button> : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Column headings (desktop) */}
          <div className={`hidden gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 lg:grid ${COLS}`}>
            <span>{terms.task.one} / {terms.subtask.one}</span>
            <span>Owner / Assignee</span>
            <span>Start → Due</span>
            <span title="Man-hours logged / expected hours">Hours</span>
            <span title="Share of the parent's progress. Owners can click to change it.">Weight</span>
            <span>Progress</span>
          </div>
          {visibleTasks.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing matches this filter.</p>}
          {visibleTasks.map((t) => (
            <TaskBlock
              key={t.id}
              task={t}
              project={project}
              weight={weights.get(t.id) ?? 0}
              canTaskWeights={canTaskWeights && liveTasks.length > 1}
              onEditTaskWeights={() => setWeightsOpen(true)}
              open={!collapsed.has(t.id)}
              onToggle={() => toggle(t.id)}
              highlight={filter === "all" ? null : matches}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canCreateTask && !adding && tasks.length > 0 && (
          <Button variant="secondary" onClick={() => setAdding(true)}>+ Add {terms.task.one.toLowerCase()}</Button>
        )}
        {cancelledCount > 0 && (
          <button onClick={() => setShowCancelled((s) => !s)} className="text-xs text-slate-500 hover:text-indigo-600">
            {showCancelled ? "Hide" : "Show"} {cancelledCount} cancelled
          </button>
        )}
        {canTaskWeights && <span className="text-xs text-slate-400">Tip: click any weight to change it.</span>}
      </div>
      {adding && (
        <div className="mt-3">
          <AddItemRow
            autoFocus
            placeholder={`${terms.task.one} name, e.g. "Vendor onboarding"`}
            personLabel={`${terms.task.one} owner…`}
            restrictTo={members}
            defaultStart={project.startDate}
            onCancel={() => setAdding(false)}
            onAdd={(v) => {
              addTask(project.id, v);
              toast(`${terms.task.one} added — weights rebalanced evenly`);
            }}
          />
          <p className="mt-1 text-xs text-slate-500">Press Enter to add and keep going.</p>
        </div>
      )}
      <WeightEditor open={weightsOpen} onClose={() => setWeightsOpen(false)} siblings={tasks} parentLabel={project.name} />
    </div>
  );
}

function TaskBlock({ task, project, weight, canTaskWeights, onEditTaskWeights, open, onToggle, highlight }: {
  task: WorkItem;
  project: Project;
  weight: number;
  canTaskWeights: boolean;
  onEditTaskWeights: () => void;
  open: boolean;
  onToggle: () => void;
  highlight: ((i: WorkItem) => boolean) | null;
}) {
  const { state, me, terms, addSubtask } = usePreview();
  const { toast } = useToast();
  const subs = subtasksOf(state, task.id);
  const live = subs.filter((s) => s.status !== "cancelled");
  const subWeights = effectiveWeights(subs);
  const [adding, setAdding] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const canAddSub = can(state, me.id, "subtask.create", { project, item: task });
  const canSubWeights = can(state, me.id, "subtask.weights", { project, item: task }) && live.length > 1;
  const approved = live.filter((s) => s.status === "done").length;
  const dim = task.status === "cancelled";
  const members = [project.ownerId, ...project.memberIds];

  const addRow = (
    <AddItemRow
      autoFocus
      placeholder={`${terms.subtask.one} name`}
      personLabel="Assign to…"
      restrictTo={members}
      defaultStart={task.startDate}
      onCancel={() => setAdding(false)}
      onAdd={(v) => {
        addSubtask(task.id, v);
        toast(`${terms.subtask.one} added — weights rebalanced`);
      }}
    />
  );

  return (
    <div className={`border-b border-slate-100 last:border-b-0 ${dim ? "opacity-50" : ""}`}>
      {/* Task row */}
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-slate-50/70 ${COLS}`}>
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onToggle}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700 ${subs.length === 0 ? "invisible" : ""}`}
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
          >
            <span className={`transition ${open ? "rotate-90" : ""}`}>▸</span>
          </button>
          <div className="min-w-0">
            <Link href={itemLink(state, task.id)} className="block truncate font-medium text-slate-900 hover:text-indigo-700">{task.title}</Link>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              <span className="hidden lg:inline"><StatusPill status={task.status} /></span>
              {subs.length > 0 ? `${approved}/${live.length} ${terms.subtask.many.toLowerCase()} approved` : `No ${terms.subtask.many.toLowerCase()} — the owner does this one`}
            </p>
          </div>
        </div>
        <div className="lg:hidden"><StatusPill status={task.status} /></div>
        <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 lg:contents">
          <PersonChip id={task.personId} showSubtitle emptyLabel="No owner" />
          <DateRange start={task.startDate} due={task.dueDate} status={task.status} />
          <HoursBadge item={task} />
          <WeightCell value={weight} canEdit={canTaskWeights} onEdit={onEditTaskWeights} title={`Counts for ${weightLabel(weight)} of the ${terms.project.one.toLowerCase()}.`} />
          <ProgressBar value={taskProgress(state, task)} showLabel className="min-w-32 flex-1 lg:flex-none" />
        </div>
      </div>
      {(task.status === "in_review" || (subs.length === 0 && task.status !== "cancelled")) && (
        <div className="-mt-1 px-4 pb-3 pl-12"><WorkActions item={task} compact /></div>
      )}

      {/* Subtasks */}
      {open && subs.length > 0 && (
        <div className="bg-slate-50/60 pb-2">
          {subs.map((s) => {
            const hit = highlight ? highlight(s) : true;
            const w = subWeights.get(s.id) ?? 0;
            return (
              <div
                key={s.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2 pl-12 pr-4 ${COLS} ${hit ? "" : "opacity-40"} ${s.status === "cancelled" ? "opacity-50" : ""}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <StatusDot status={s.status} />
                  <div className="min-w-0">
                    <Link href={itemLink(state, s.id)} className={`block truncate text-sm text-slate-800 hover:text-indigo-700 ${s.status === "done" ? "text-slate-500 line-through decoration-slate-300" : ""}`}>{s.title}</Link>
                    {s.changesRequested && <p className="truncate text-xs text-orange-600">↩ Changes requested</p>}
                  </div>
                </div>
                <div className="lg:hidden"><StatusPill status={s.status} /></div>
                <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 lg:contents">
                  <PersonChip id={s.personId} emptyLabel="Needs assignee" />
                  <DateRange start={s.startDate} due={s.dueDate} status={s.status} />
                  <HoursBadge item={s} />
                  <WeightCell value={w} canEdit={canSubWeights} onEdit={() => setWeightsOpen(true)} title={`Counts for ${weightLabel(w)} of “${task.title}”.`} />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="hidden lg:inline"><StatusPill status={s.status} /></span>
                    <WorkActions item={s} compact />
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3 pl-12 pr-4 pt-1">
            {canAddSub && !adding && (
              <button onClick={() => setAdding(true)} className="text-xs font-medium text-indigo-600 hover:underline">+ Add {terms.subtask.one.toLowerCase()}</button>
            )}
            {canSubWeights && (
              <button onClick={() => setWeightsOpen(true)} className="text-xs font-medium text-slate-600 hover:text-indigo-600">⚖ Adjust {terms.subtask.one.toLowerCase()} weights</button>
            )}
          </div>
          {adding && <div className="pl-12 pr-4 pt-2">{addRow}</div>}
        </div>
      )}
      {open && subs.length === 0 && canAddSub && task.status !== "cancelled" && (
        <div className="px-4 pb-3 pl-12">
          {adding ? addRow : (
            <button onClick={() => setAdding(true)} className="text-xs font-medium text-indigo-600 hover:underline">+ Split into {terms.subtask.many.toLowerCase()}</button>
          )}
        </div>
      )}
      <WeightEditor open={weightsOpen} onClose={() => setWeightsOpen(false)} siblings={subs} parentLabel={task.title} />
    </div>
  );
}

function StatusDot({ status }: { status: WorkItem["status"] }) {
  const map: Record<WorkItem["status"], { cls: string; icon: string }> = {
    not_started: { cls: "border-slate-300 bg-white text-transparent", icon: "" },
    in_progress: { cls: "border-blue-400 bg-blue-50 text-blue-500", icon: "◐" },
    in_review: { cls: "border-amber-400 bg-amber-50 text-amber-600", icon: "⧗" },
    done: { cls: "border-green-500 bg-green-500 text-white", icon: "✓" },
    cancelled: { cls: "border-slate-300 bg-slate-100 text-slate-400", icon: "–" },
  };
  const m = map[status];
  return <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${m.cls}`} aria-hidden>{m.icon}</span>;
}
