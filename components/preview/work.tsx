"use client";

// Work-item building blocks shared by My Work, Reviews, the project tree and
// the task page: the context-aware action buttons, the review dialogs, the
// weight editor and the inline "add" row.

import { useMemo, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { usePreview } from "@/lib/preview/store";
import {
  can,
  effectiveWeights,
  itemById,
  personById,
  projectById,
  projectProgress,
  reviewerIdFor,
  subtasksOf,
  taskProgress,
  pct,
  weightLabel,
  allocatedHours,
  hrs,
} from "@/lib/preview/engine";
import type { PreviewState, WorkItem } from "@/lib/preview/types";
import { Button, Field, PersonSelect, inputCls } from "./ui";

// ── Action buttons ─────────────────────────────────────────────────────────

/**
 * The buttons the *current user* can press on an item, in plain words:
 * Start → Mark complete → (reviewer) Approve / Request changes → Reopen.
 */
export function WorkActions({ item, size = "sm", compact = false }: { item: WorkItem; size?: "sm" | "md"; compact?: boolean }) {
  const { state, me, terms, startWork, submitForReview, approve, reopen } = usePreview();
  const { toast } = useToast();
  const [changesOpen, setChangesOpen] = useState(false);
  const project = projectById(state, item.projectId);
  if (!project) return null;

  const target = { project, item };
  const canWork = can(state, me.id, "item.work", target);
  const canReview = can(state, me.id, "item.review", target);
  const reviewerId = reviewerIdFor(state, item);
  const reviewer = personById(state, reviewerId);
  const hasSubs = !item.parentId && subtasksOf(state, item.id).length > 0;
  const iAmReviewer = reviewerId === me.id;

  const buttons: React.ReactNode[] = [];

  if (item.status === "not_started" && canWork) {
    buttons.push(
      <Button key="start" size={size} variant="secondary" onClick={() => { startWork(item.id); toast(`Started “${item.title}”`); }}>
        ▶ Start
      </Button>
    );
  }
  if ((item.status === "not_started" || item.status === "in_progress") && canWork && !hasSubs) {
    buttons.push(
      <Button
        key="complete"
        size={size}
        variant="primary"
        title={iAmReviewer ? "You are the reviewer, so this is approved right away." : `Sends it to ${reviewer?.name ?? "the owner"} for review.`}
        onClick={() => {
          submitForReview(item.id);
          toast(iAmReviewer ? `“${item.title}” completed and approved` : `Sent to ${reviewer?.name ?? "the owner"} for review`);
        }}
      >
        ✓ Mark complete
      </Button>
    );
  }
  if (item.status === "in_review" && canReview) {
    buttons.push(
      <Button key="approve" size={size} variant="success" onClick={() => { approve(item.id); toast(`Approved “${item.title}” — progress updated`); }}>
        ✓ Approve
      </Button>,
      <Button key="changes" size={size} variant="secondary" onClick={() => setChangesOpen(true)}>
        ↩ Request changes
      </Button>
    );
  }
  // Reopening is rare, so compact lists leave it to the item's own page/panel.
  if (item.status === "done" && !compact && (canReview || can(state, me.id, "task.edit", target))) {
    buttons.push(
      <Button key="reopen" size={size} variant="ghost" onClick={() => { reopen(item.id); toast(`Reopened “${item.title}”`, "info"); }}>
        ↺ Reopen
      </Button>
    );
  }

  let hint: React.ReactNode = null;
  if (item.status === "in_review" && !canReview) {
    hint = <span className="text-xs text-amber-700">Waiting for {reviewer?.name ?? "the owner"} to review</span>;
  } else if (hasSubs && item.status !== "done" && item.status !== "in_review" && !compact) {
    hint = (
      <span className="text-xs text-slate-500">
        Completes automatically when all {terms.subtask.many.toLowerCase()} are approved
      </span>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {buttons}
        {hint}
      </div>
      <RequestChangesModal item={item} open={changesOpen} onClose={() => setChangesOpen(false)} />
    </>
  );
}

export function RequestChangesModal({ item, open, onClose }: { item: WorkItem; open: boolean; onClose: () => void }) {
  const { state, requestChanges } = usePreview();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const who = personById(state, item.personId);
  return (
    <Modal open={open} onClose={onClose} title="Request changes">
      <p className="mb-3 text-sm text-slate-600">
        Tell {who?.name ?? "the assignee"} what needs to change on <strong>{item.title}</strong>. It goes back to them as
        &nbsp;“In progress”, with your note shown at the top.
      </p>
      <textarea
        autoFocus
        rows={4}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className={inputCls}
        placeholder="e.g. Please add the missing vendor GST numbers before resubmitting."
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          disabled={!note.trim()}
          onClick={() => {
            requestChanges(item.id, note.trim());
            toast("Sent back with your note", "info");
            setNote("");
            onClose();
          }}
        >
          Send back
        </Button>
      </div>
    </Modal>
  );
}

// ── Weight editor ──────────────────────────────────────────────────────────

type Draft = { id: string; weight: number; locked: boolean };

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Set one item's weight and rebalance the rest so the total stays exactly
 * 100%. Unlocked items absorb the change in proportion to their current size;
 * if every other item is locked, they all absorb it.
 */
function rebalance(draft: Draft[], id: string, value: number): Draft[] {
  const others = draft.filter((d) => d.id !== id);
  let pool = others.filter((d) => !d.locked);
  if (pool.length === 0) pool = others;
  const fixed = others.filter((d) => !pool.includes(d)).reduce((s, d) => s + d.weight, 0);
  const w = round1(Math.max(0, Math.min(100 - fixed, value || 0)));
  const remaining = 100 - fixed - w;
  const poolSum = pool.reduce((s, d) => s + d.weight, 0);
  const next = new Map<string, number>();
  pool.forEach((d) => next.set(d.id, round1(poolSum > 0 ? (d.weight / poolSum) * remaining : remaining / pool.length)));
  // Give any rounding drift to the largest pool item so the total is exactly 100.
  if (pool.length) {
    const total = w + fixed + [...next.values()].reduce((s, x) => s + x, 0);
    const biggest = pool.reduce((a, b) => ((next.get(a.id) ?? 0) >= (next.get(b.id) ?? 0) ? a : b));
    next.set(biggest.id, Math.max(0, round1((next.get(biggest.id) ?? 0) + (100 - total))));
  }
  return draft.map((d) =>
    d.id === id ? { ...d, weight: w, locked: true } : next.has(d.id) ? { ...d, weight: next.get(d.id)! } : d
  );
}

type WeightEditorProps = { open: boolean; onClose: () => void; siblings: WorkItem[]; parentLabel: string };

/**
 * Owners decide how much each item counts toward its parent. It starts as an
 * even split; changing one item rebalances the others so the total is always
 * 100%. Items you have changed are locked so later changes don't move them.
 */
export function WeightEditor(props: WeightEditorProps) {
  // Mounted only while open so the draft starts fresh every time.
  return props.open ? <WeightEditorBody {...props} /> : null;
}

function WeightEditorBody({ open, onClose, siblings, parentLabel }: WeightEditorProps) {
  const { state, setWeights, resetWeights } = usePreview();
  const { toast } = useToast();
  const live = siblings.filter((s) => s.status !== "cancelled");
  const [draft, setDraft] = useState<Draft[]>(() => {
    const eff = effectiveWeights(siblings);
    return live.map((s) => ({ id: s.id, weight: round1(eff.get(s.id) ?? 0), locked: false }));
  });
  // "Even" saves automatic weights that keep rebalancing as items are added.
  const [even, setEven] = useState(() => live.every((s) => s.weightMode === "auto"));
  const total = round1(draft.reduce((s, d) => s + d.weight, 0));

  // Live preview of what the parent's progress would become.
  const previewProgress = useMemo(() => {
    if (!siblings.length) return null;
    const temp: PreviewState = { ...state, items: state.items.map((i) => {
      const d = draft.find((x) => x.id === i.id);
      return d ? { ...i, weight: d.weight, weightMode: "manual" as const } : i;
    }) };
    const first = siblings[0];
    if (first.parentId) {
      const parent = itemById(temp, first.parentId);
      return parent ? { now: taskProgress(state, parent).approved, next: taskProgress(temp, parent).approved } : null;
    }
    const project = projectById(temp, first.projectId);
    return project ? { now: projectProgress(state, project).approved, next: projectProgress(temp, project).approved } : null;
  }, [draft, siblings, state]);

  const setOne = (id: string, value: number) => {
    setEven(false);
    setDraft((ds) => rebalance(ds, id, value));
  };
  const toggleLock = (id: string) => setDraft((ds) => ds.map((d) => (d.id === id ? { ...d, locked: !d.locked } : d)));
  const resetEven = () => {
    setEven(true);
    setDraft((ds) => ds.map((d) => ({ ...d, weight: round1(100 / ds.length), locked: false })));
  };

  return (
    <Modal open={open} onClose={onClose} title={`Adjust weights — ${parentLabel}`} widthClass="max-w-2xl">
      <p className="mb-1 text-sm text-slate-600">
        Weight is how much each item counts toward <strong>{parentLabel}</strong>&apos;s progress. Drag a slider or type a number;
        the other items adjust automatically so the total always stays at <strong>100%</strong>.
      </p>
      <p className="mb-4 text-xs text-slate-500">🔒 Items you change are locked so they don&apos;t move when you adjust the next one. Click the lock to release it.</p>
      <div className="space-y-3">
        {draft.map((d) => {
          const item = siblings.find((s) => s.id === d.id)!;
          return (
            <div key={d.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_200px_120px]">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{item.title}</p>
                <p className="text-xs text-slate-500">{personById(state, item.personId)?.name ?? "Unassigned"}</p>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={d.weight}
                onChange={(e) => setOne(d.id, Number(e.target.value))}
                className="order-3 col-span-2 w-full accent-indigo-600 sm:order-none sm:col-span-1"
                aria-label={`Weight for ${item.title}`}
              />
              <div className="flex items-center justify-end gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={d.weight}
                  onChange={(e) => setOne(d.id, Number(e.target.value))}
                  className="w-16 rounded border border-slate-300 px-1.5 py-1 text-right text-sm"
                  aria-label={`Weight % for ${item.title}`}
                />
                <span className="text-xs text-slate-400">%</span>
                <button
                  onClick={() => toggleLock(d.id)}
                  className={`rounded px-1 text-sm ${d.locked ? "opacity-100" : "opacity-30 hover:opacity-60"}`}
                  title={d.locked ? "Locked — click to let it adjust" : "Click to lock this value"}
                  aria-label={d.locked ? "Unlock" : "Lock"}
                >
                  {d.locked ? "🔒" : "🔓"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <span>
          Total: <strong className="text-green-700">{weightLabel(total)}</strong>
          {even && <span className="ml-2 text-xs text-slate-500">(even split — new items will share automatically)</span>}
        </span>
        {previewProgress && (
          <span className="text-xs text-slate-500">
            Progress {pct(previewProgress.now)} → <strong className="text-slate-800">{pct(previewProgress.next)}</strong>
          </span>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={resetEven}>↺ Reset to even split</Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (even) resetWeights(draft.map((d) => d.id));
              else setWeights(draft.map((d) => ({ id: d.id, weight: d.weight, mode: "manual" as const })));
              toast("Weights saved — progress recalculated");
              onClose();
            }}
          >
            Save weights
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** A weight value that owners can click to open the editor. */
export function WeightCell({ value, canEdit, onEdit, title }: { value: number; canEdit: boolean; onEdit: () => void; title: string }) {
  if (!canEdit) {
    return <span className="text-sm tabular-nums text-slate-600" title={`${title} Only the owner can change it.`}>{weightLabel(value)}</span>;
  }
  return (
    <button
      onClick={onEdit}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-indigo-300 px-1.5 py-0.5 text-sm tabular-nums text-indigo-700 hover:border-indigo-500 hover:bg-indigo-50"
      title={`${title} Click to adjust.`}
    >
      {weightLabel(value)} <span className="text-[10px]" aria-hidden>✎</span>
    </button>
  );
}

// ── Inline add row ─────────────────────────────────────────────────────────

export interface NewItemValues {
  title: string;
  personId: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
}

/** Title, person, start & due dates and expected hours. Enter adds and keeps going. */
export function AddItemRow({ placeholder, personLabel, onAdd, restrictTo, autoFocus = false, onCancel, defaultStart }: {
  placeholder: string;
  personLabel: string;
  onAdd: (v: NewItemValues) => void;
  restrictTo?: string[];
  autoFocus?: boolean;
  onCancel?: () => void;
  defaultStart?: string | null;
}) {
  const [title, setTitle] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [start, setStart] = useState(defaultStart ?? "");
  const [due, setDue] = useState("");
  const [hours, setHours] = useState("");
  const badDates = !!start && !!due && due < start;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || badDates) return;
    onAdd({ title: title.trim(), personId, startDate: start || null, dueDate: due || null, estimatedHours: hours ? Number(hours) : null });
    setTitle("");
    setDue("");
    setHours("");
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          autoFocus={autoFocus}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel?.()}
          placeholder={placeholder}
          className={`${inputCls} sm:flex-1`}
          aria-label="Title"
        />
        <PersonSelect value={personId} onChange={setPersonId} emptyLabel={personLabel} restrictTo={restrictTo} className="sm:w-56" />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Start date
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${inputCls} mt-0.5 w-40`} />
        </label>
        <label className="text-xs text-slate-600">
          Due date
          <input type="date" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} className={`${inputCls} mt-0.5 w-40`} />
        </label>
        <label className="text-xs text-slate-600">
          Expected hours
          <input type="number" min={0} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 8" className={`${inputCls} mt-0.5 w-28`} />
        </label>
        <div className="ml-auto flex gap-2">
          <Button type="submit" disabled={!title.trim() || badDates}>Add</Button>
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Done</Button>}
        </div>
      </div>
      {badDates && <p className="text-xs text-red-600">The due date must be on or after the start date.</p>}
    </form>
  );
}

// ── Edit item modal ────────────────────────────────────────────────────────

type EditItemProps = { item: WorkItem; open: boolean; onClose: () => void };

export function EditItemModal(props: EditItemProps) {
  return props.open ? <EditItemBody {...props} /> : null;
}

function EditItemBody({ item, open, onClose }: EditItemProps) {
  const { state, terms, updateItem } = usePreview();
  const { toast } = useToast();
  const project = projectById(state, item.projectId);
  const [form, setForm] = useState({ title: item.title, description: item.description, personId: item.personId, dueDate: item.dueDate ?? "", startDate: item.startDate ?? "", priority: item.priority, estimatedHours: item.estimatedHours?.toString() ?? "" });
  const isSub = !!item.parentId;
  const members = project ? [project.ownerId, ...project.memberIds] : undefined;
  const allocated = isSub ? 0 : allocatedHours(state, item);
  const badDates = !!form.startDate && !!form.dueDate && form.dueDate < form.startDate;
  return (
    <Modal open={open} onClose={onClose} title={`Edit ${isSub ? terms.subtask.one.toLowerCase() : terms.task.one.toLowerCase()}`} widthClass="max-w-xl">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (badDates) return;
          updateItem(item.id, {
            title: form.title.trim() || item.title,
            description: form.description,
            personId: form.personId,
            dueDate: form.dueDate || null,
            startDate: form.startDate || null,
            priority: form.priority,
            estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : null,
          });
          toast("Saved");
          onClose();
        }}
      >
        <Field label="Title"><input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label={isSub ? "Assigned to" : `${terms.task.one} owner`} hint={isSub ? "The person who does the work." : `Responsible for the ${terms.task.one.toLowerCase()}: splits it into ${terms.subtask.many.toLowerCase()} and reviews them.`}>
          <PersonSelect value={form.personId} onChange={(v) => setForm({ ...form, personId: v })} restrictTo={members} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
          <Field label="Due date"><input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          <Field label="Priority">
            <select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as WorkItem["priority"] })}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </Field>
          <Field
            label="Expected hours"
            hint={!isSub && allocated > 0 ? `${terms.subtask.many} add up to ${hrs(allocated)}${form.estimatedHours ? "" : " — used when this is empty"}.` : "Planned effort for this work."}
          >
            <input type="number" min={0} step={0.5} className={inputCls} value={form.estimatedHours} onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })} />
          </Field>
        </div>
        {badDates && <p className="text-xs text-red-600">The due date must be on or after the start date.</p>}
        <Field label="Description"><textarea rows={3} className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={badDates}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

/** "Website Relaunch › Design system" style context line for lists. */
export function ItemContext({ item }: { item: WorkItem }) {
  const { state } = usePreview();
  const project = projectById(state, item.projectId);
  const parent = item.parentId ? itemById(state, item.parentId) : null;
  return (
    <span className="truncate text-xs text-slate-500">
      <Link href={`/preview/projects/${item.projectId}`} className="hover:text-indigo-600 hover:underline">{project?.name}</Link>
      {parent && (
        <>
          {" › "}
          <Link href={`/preview/projects/${item.projectId}/tasks/${parent.id}`} className="hover:text-indigo-600 hover:underline">{parent.title}</Link>
        </>
      )}
    </span>
  );
}
