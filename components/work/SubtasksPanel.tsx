"use client";

/**
 * The subtasks of one task: who does each piece, when, how much it counts,
 * and where it is in review. Used on the task page and in the board's task
 * popup, so subtasks behave the same everywhere.
 *
 * Who can do what mirrors the server (lib/permissions.ts): the task owner
 * and the project's managers shape the list and set weights; the assignee
 * works and marks complete; the task owner approves or sends back.
 */

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { apiFetch, isConflict } from "@/lib/api-client";
import { can, type SpineContext } from "@/lib/permissions";
import type { SubtaskDto } from "@/lib/subtasks";
import {
  DateRange,
  PersonLine,
  PersonSelect,
  StatusDot,
  SubtaskStatusBadge,
  WeightChip,
  WeightEditor,
  WorkProgress,
  type PickPerson,
} from "./kit";
import { taskProgress } from "@/lib/work-engine";
import { SPEC_LABELS, type SpecKey } from "@/lib/workflow";

type Action = "start" | "submit" | "approve" | "request_changes" | "reopen" | "cancel" | "restore";

export interface PanelTask {
  id: number;
  project_id: number;
  title: string;
  status: "todo" | "in_progress" | "review" | "done";
  assignee_id: number | null;
}

export default function SubtasksPanel({
  task,
  currentUser,
  isManager,
  people,
  readOnly,
  specPending = 0,
  onTaskChanged,
  openSubtaskId = null,
  compact = false,
}: {
  task: PanelTask;
  currentUser: { id: number; role: "admin" | "member" };
  /** Admin, project lead or project owner. */
  isManager: boolean;
  /** Project members, for assigning. */
  people: PickPerson[];
  /** Signed off, or the project is locked. */
  readOnly: boolean;
  /** Spec points not on the list yet ("+ From specification"). */
  specPending?: number;
  /** Something changed that may have moved the task (status, progress). */
  onTaskChanged: () => void;
  /** Expand this subtask on load (a notification linked to it). */
  openSubtaskId?: number | null;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [subs, setSubs] = useState<SubtaskDto[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(openSubtaskId);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [changesFor, setChangesFor] = useState<SubtaskDto | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ subtasks: SubtaskDto[] }>(`/api/tasks/${task.id}/subtasks`);
      setSubs(res.subtasks);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load subtasks");
    }
  }, [task.id]);

  useEffect(() => {
    // Fetch on mount; state is set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const base: SpineContext = {
    userId: currentUser.id,
    isAdmin: currentUser.role === "admin",
    projectRole: isManager ? "lead" : "member",
    projectOwnerId: null,
    taskOwnerId: task.assignee_id,
  };
  const approvedTask = task.status === "done";
  const mayShape = !readOnly && can("subtask.create", base) && (!approvedTask || isManager);
  const mayWeigh = !readOnly && can("subtask.weights", base);
  const ctxFor = (s: SubtaskDto): SpineContext => ({ ...base, subtaskAssigneeId: s.assignee_id });

  async function refreshAll() {
    await load();
    onTaskChanged();
  }

  async function act(s: SubtaskDto, action: Action, note?: string) {
    setBusy(s.id);
    try {
      const res = await apiFetch<{ status: string; taskStatus: string }>(`/api/subtasks/${s.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, note }),
      });
      const message: Record<Action, string> = {
        start: "Started",
        submit: res.status === "done" ? "Done and approved" : "Sent to the task owner for review",
        approve: "Approved — progress updated",
        request_changes: "Sent back with your note",
        reopen: "Reopened",
        cancel: "Cancelled — weights rebalanced",
        restore: "Restored",
      };
      toast(res.taskStatus === "review" && (action === "approve" || action === "submit") ? `${message[action]}. Every subtask is approved, so the task is now waiting for review.` : message[action]);
      await refreshAll();
    } catch (e) {
      if (isConflict(e)) await refreshAll();
      toast(e instanceof Error ? e.message : "That didn't work", "error");
    } finally {
      setBusy(null);
    }
  }

  async function patch(s: SubtaskDto, body: Record<string, unknown>, done = "Saved") {
    setBusy(s.id);
    try {
      await apiFetch(`/api/subtasks/${s.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast(done);
      await refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(s: SubtaskDto) {
    setBusy(s.id);
    try {
      await apiFetch(`/api/subtasks/${s.id}`, { method: "DELETE" });
      toast("Subtask deleted");
      await refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
    } finally {
      setBusy(null);
    }
  }

  async function fromSpec() {
    setSeeding(true);
    try {
      const res = await apiFetch<{ added: number }>(`/api/tasks/${task.id}/subtasks/from-spec`, { method: "POST" });
      toast(res.added === 1 ? "1 subtask added from the specification" : `${res.added} subtasks added from the specification`);
      await refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not read the specification", "error");
    } finally {
      setSeeding(false);
    }
  }

  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!subs) return <p className="text-sm text-slate-500">Loading subtasks…</p>;

  const live = subs.filter((s) => s.status !== "cancelled");
  const approved = live.filter((s) => s.status === "done").length;
  const progress = taskProgress(task.status, subs.map((s) => ({ id: s.id, status: s.status, weight: s.weight, weight_mode: s.weight_mode })));

  return (
    <section aria-label="Subtasks">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">
          Subtasks{" "}
          {live.length > 0 && (
            <span className="font-normal text-slate-500">
              ({approved}/{live.length} approved)
            </span>
          )}
        </h3>
        <div className="flex flex-wrap gap-2">
          {mayShape && specPending > 0 && (
            <button
              type="button"
              onClick={fromSpec}
              disabled={seeding}
              title="Add what this task's specification asks for as subtasks for its owner"
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
            >
              {seeding ? "Adding…" : `+ From specification (${specPending})`}
            </button>
          )}
          {mayWeigh && live.length > 1 && (
            <button type="button" onClick={() => setWeightsOpen(true)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
              ⚖ Adjust weights
            </button>
          )}
          {mayShape && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700">
              + Add subtask
            </button>
          )}
        </div>
      </div>

      {live.length > 0 && <WorkProgress approved={progress.approved} pending={progress.pending} showLabel label="Task progress" className="mb-3" />}

      {subs.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
          {mayShape
            ? "No subtasks yet. Split this task into pieces and give each one to a person — or just do it yourself and send it for review."
            : "No subtasks — the task owner is doing this one directly."}
        </div>
      )}

      {subs.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {subs.map((s) => {
            const c = ctxFor(s);
            const mayWork = !readOnly && can("subtask.work", c);
            const mayReview = !readOnly && can("subtask.review", c);
            const mayReopen = !readOnly && (s.status === "review" ? mayWork : can("subtask.reopen", c) && (!approvedTask || isManager));
            const open = expanded === s.id;
            return (
              <li key={s.id} className={`${s.status === "cancelled" ? "opacity-60" : ""} ${open ? "bg-slate-50/70" : ""}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                  <StatusDot status={s.status} />
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : s.id)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className={`block truncate text-sm font-medium ${s.status === "done" ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900"}`}>
                      {s.title}
                    </span>
                    {s.source && SPEC_LABELS[s.source as SpecKey] && (
                      <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600" title="The part of the specification this came from">
                        {SPEC_LABELS[s.source as SpecKey]}
                      </span>
                    )}
                    {s.changes_requested && s.status === "in_progress" && (
                      <span className="block truncate text-xs text-orange-700">↩ Changes requested: {s.changes_requested}</span>
                    )}
                  </button>
                  {!compact && (
                    <span className="w-28">
                      <DateRange start={s.start_date} due={s.due_date} finished={s.status === "done" || s.status === "cancelled"} notStarted={s.status === "todo"} />
                    </span>
                  )}
                  <span className={compact ? "w-36" : "w-52"}>
                    <PersonLine name={s.assignee_name} designation={compact ? null : s.assignee_designation} department={compact ? null : s.assignee_department} empty="Needs assignee" />
                  </span>
                  <span className="w-16">
                  <WeightChip
                    value={s.effective_weight ?? 0}
                    canEdit={mayWeigh && live.length > 1 && s.status !== "cancelled"}
                    onEdit={() => setWeightsOpen(true)}
                    title={`Counts for this share of "${task.title}".`}
                  />
                  </span>
                  <SubtaskStatusBadge status={s.status} />
                  <div className="flex flex-wrap gap-1.5">
                    {s.status === "todo" && mayWork && (
                      <Btn onClick={() => act(s, "start")} busy={busy === s.id} variant="secondary">▶ Start</Btn>
                    )}
                    {(s.status === "todo" || s.status === "in_progress") && mayWork && (
                      <Btn onClick={() => act(s, "submit")} busy={busy === s.id}>✓ Mark complete</Btn>
                    )}
                    {s.status === "review" && mayReview && (
                      <>
                        <Btn onClick={() => act(s, "approve")} busy={busy === s.id} variant="success">✓ Approve</Btn>
                        <Btn onClick={() => setChangesFor(s)} busy={busy === s.id} variant="secondary">↩ Request changes</Btn>
                      </>
                    )}
                    {s.status === "review" && !mayReview && (
                      <span className="text-xs text-amber-700">Waiting for the task owner</span>
                    )}
                  </div>
                </div>
                {open && (
                  <SubtaskDetails
                    s={s}
                    people={people}
                    mayShape={mayShape}
                    mayReopen={mayReopen}
                    busy={busy === s.id}
                    onPatch={(body, msg) => patch(s, body, msg)}
                    onAct={(a) => act(s, a)}
                    onDelete={() => remove(s)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <AddSubtask
          people={people}
          defaultAssignee={task.assignee_id}
          onCancel={() => setAdding(false)}
          onAdd={async (body) => {
            try {
              await apiFetch(`/api/tasks/${task.id}/subtasks`, { method: "POST", body: JSON.stringify(body) });
              toast("Subtask added — weights rebalanced");
              await refreshAll();
              return true;
            } catch (e) {
              toast(e instanceof Error ? e.message : "Could not add the subtask", "error");
              return false;
            }
          }}
        />
      )}

      <WeightEditor
        open={weightsOpen}
        onClose={() => setWeightsOpen(false)}
        parentLabel={task.title}
        endpoint={`/api/tasks/${task.id}/subtasks/weights`}
        onSaved={() => void refreshAll()}
        items={live.map((s) => ({ id: s.id, title: s.title, who: s.assignee_name, weight: s.effective_weight ?? 0, auto: s.weight_mode === "auto" }))}
      />

      <RequestChanges
        subtask={changesFor}
        onClose={() => setChangesFor(null)}
        onSend={async (note) => {
          if (!changesFor) return;
          await act(changesFor, "request_changes", note);
          setChangesFor(null);
        }}
      />
    </section>
  );
}

function Btn({
  children,
  onClick,
  busy,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  variant?: "primary" | "secondary" | "success";
}) {
  const styles = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
  };
  return (
    <button type="button" onClick={onClick} disabled={busy} className={`rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${styles[variant]}`}>
      {children}
    </button>
  );
}

const inputCls =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/** Expanded row: description, dates and assignee (owner / managers), plus rarer actions. */
function SubtaskDetails({
  s,
  people,
  mayShape,
  mayReopen,
  busy,
  onPatch,
  onAct,
  onDelete,
}: {
  s: SubtaskDto;
  people: PickPerson[];
  mayShape: boolean;
  mayReopen: boolean;
  busy: boolean;
  onPatch: (body: Record<string, unknown>, msg?: string) => void;
  onAct: (a: Action) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(s.title);
  const [description, setDescription] = useState(s.description ?? "");
  const [start, setStart] = useState(s.start_date?.slice(0, 10) ?? "");
  const [due, setDue] = useState(s.due_date?.slice(0, 10) ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty =
    title.trim() !== s.title ||
    description !== (s.description ?? "") ||
    start !== (s.start_date?.slice(0, 10) ?? "") ||
    due !== (s.due_date?.slice(0, 10) ?? "");
  const badDates = !!start && !!due && due < start;

  return (
    <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-3 sm:pl-11">
      {mayShape ? (
        <>
          <label className="block text-xs font-medium text-slate-600">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} mt-1 w-full`} />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Description
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} mt-1 w-full`} placeholder="What does done look like?" />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-slate-600">
              Start date
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${inputCls} mt-1 block`} />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Due date
              <input type="date" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} className={`${inputCls} mt-1 block`} />
            </label>
            <button
              type="button"
              disabled={!dirty || badDates || !title.trim() || busy}
              onClick={() => onPatch({ title: title.trim(), description, startDate: start || null, dueDate: due || null })}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save changes
            </button>
          </div>
          {badDates && <p className="text-xs text-red-600">The due date can&apos;t be before the start date.</p>}
          <label className="block text-xs font-medium text-slate-600">
            Assigned to
            <PersonSelect
              people={people}
              value={s.assignee_id}
              onChange={(id) => onPatch({ assigneeId: id }, id ? "Reassigned" : "Unassigned")}
              emptyLabel="Nobody yet"
              className="mt-1 block w-full sm:w-80"
              label="Assigned to"
            />
          </label>
        </>
      ) : (
        s.description && <p className="whitespace-pre-wrap text-sm text-slate-600">{s.description}</p>
      )}
      {s.approver_name && s.status === "done" && (
        <p className="text-xs text-slate-500">Approved by {s.approver_name}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {(s.status === "done" || s.status === "review") && mayReopen && (
          <Btn onClick={() => onAct("reopen")} busy={busy} variant="secondary">
            {s.status === "review" ? "↺ Take it back" : "↺ Reopen"}
          </Btn>
        )}
        {mayShape && s.status !== "done" && s.status !== "cancelled" && (
          <Btn onClick={() => onAct("cancel")} busy={busy} variant="secondary">Cancel subtask</Btn>
        )}
        {mayShape && s.status === "cancelled" && (
          <Btn onClick={() => onAct("restore")} busy={busy} variant="secondary">Restore</Btn>
        )}
        {mayShape && (
          <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
            Delete
          </button>
        )}
      </div>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete subtask?">
        <p className="text-sm text-slate-600">
          This removes “{s.title}” for good. If the work was just dropped, <strong>Cancel</strong> it instead to keep the history.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Keep it
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(false);
              onDelete();
            }}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}

function AddSubtask({
  people,
  defaultAssignee,
  onAdd,
  onCancel,
}: {
  people: PickPerson[];
  defaultAssignee: number | null;
  onAdd: (body: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<number | null>(defaultAssignee);
  const [start, setStart] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const badDates = !!start && !!due && due < start;

  return (
    <form
      className="mt-3 space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || badDates) return;
        setSaving(true);
        const ok = await onAdd({ title: title.trim(), assigneeId: assignee, startDate: start || null, dueDate: due || null });
        setSaving(false);
        if (ok) {
          setTitle("");
          setDue("");
        }
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          placeholder='Subtask, e.g. "Collect vendor quotes"'
          aria-label="Subtask title"
          className={`${inputCls} sm:flex-1`}
        />
        <PersonSelect people={people} value={assignee} onChange={setAssignee} emptyLabel="Assign to…" className="sm:w-60" label="Assign to" />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-slate-600">
          Start date
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${inputCls} mt-1 block`} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Due date
          <input type="date" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} className={`${inputCls} mt-1 block`} />
        </label>
        <div className="ml-auto flex gap-2">
          <button type="submit" disabled={!title.trim() || badDates || saving} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Done
          </button>
        </div>
      </div>
      {badDates && <p className="text-xs text-red-600">The due date can&apos;t be before the start date.</p>}
      <p className="text-xs text-slate-500">Press Enter to add and keep going. New subtasks share the weight evenly.</p>
    </form>
  );
}

function RequestChanges({ subtask, onClose, onSend }: { subtask: SubtaskDto | null; onClose: () => void; onSend: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  return (
    <Modal open={!!subtask} onClose={onClose} title="Request changes">
      <p className="mb-3 text-sm text-slate-600">
        Tell {subtask?.assignee_name ?? "the assignee"} what needs to change on <strong>{subtask?.title}</strong>. It goes back to them as
        &nbsp;“In progress”, with your note shown on it.
      </p>
      <textarea
        autoFocus
        rows={4}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="What needs to change"
        className={`${inputCls} w-full`}
        placeholder="e.g. Please add the missing vendor GST numbers before resubmitting."
      />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
        <button
          type="button"
          disabled={!note.trim()}
          onClick={async () => {
            await onSend(note.trim());
            setNote("");
          }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Send back
        </button>
      </div>
    </Modal>
  );
}
