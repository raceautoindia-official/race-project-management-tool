"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { RequestStatusBadge, TaskPriorityBadge, WorkTypeBadge } from "@/components/Badge";
import { apiFetch, isConflict } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatIst } from "@/lib/tz";
import { formatDate } from "@/lib/format";
import type {
  ProjectMember,
  SpecColumns,
  Task,
  TaskPriority,
  TaskRequest,
} from "@/lib/types";
import type { SpecType } from "@/lib/workflow";
import { pickSpec, SpecView, specPayload, WorkSpecFields } from "./WorkSpec";

const PRIORITY_WORD: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/**
 * Task requests raised by project members. Anyone can raise one (correction or
 * new feature); an admin/lead approves it — choosing the assigned owner, which
 * creates the task — or rejects it with a reason. The raiser may withdraw a
 * request while it is pending.
 */
export default function TaskRequestsPanel({
  projectId,
  requests,
  onRequestsChange,
  members,
  currentUserId,
  isAdmin,
  canManage,
  writable,
  raiseOpen,
  onRaiseOpenChange,
  onTaskCreated,
  onOpenTask,
  onStale,
}: {
  projectId: number;
  requests: TaskRequest[];
  onRequestsChange: (requests: TaskRequest[]) => void;
  members: ProjectMember[];
  currentUserId: number;
  isAdmin: boolean;
  canManage: boolean;
  writable: boolean;
  raiseOpen: boolean;
  onRaiseOpenChange: (open: boolean) => void;
  onTaskCreated: (task: Task) => void;
  onOpenTask: (taskId: number) => void;
  /** Requests/tasks changed elsewhere — reload them. */
  onStale: () => void;
}) {
  const { toast } = useToast();
  const [viewing, setViewing] = useState<TaskRequest | null>(null);
  const [deciding, setDeciding] = useState<{ request: TaskRequest; mode: "approve" | "reject" } | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  function replace(updated: TaskRequest) {
    onRequestsChange(requests.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function withdraw(r: TaskRequest) {
    if (!confirm(`Withdraw your request "${r.title}"?`)) return;
    try {
      await apiFetch(`/api/requests/${r.id}`, { method: "DELETE" });
      onRequestsChange(requests.filter((x) => x.id !== r.id));
      toast("Request withdrawn");
    } catch (e) {
      if (isConflict(e)) onStale();
      toast(e instanceof Error ? e.message : "Could not withdraw request", "error");
    }
  }

  if (requests.length === 0 && !raiseOpen) return null;

  function renderRow(r: TaskRequest) {
    const mine = r.requested_by === currentUserId;
    return (
      <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setViewing(r)}
              className="truncate text-left text-sm font-medium text-slate-800 hover:text-indigo-600 hover:underline"
            >
              {r.title}
            </button>
            <WorkTypeBadge type={r.task_type} />
            <RequestStatusBadge status={r.status} pendingLabel="Awaiting approval" />
          </div>
          <div className="mt-0.5 text-xs text-slate-600">
            Raised by {mine ? "you" : r.requester_name ?? "—"} · {formatIst(r.requested_at)}
            {r.status !== "pending" && r.decider_name && (
              <>
                {" "}· {r.status === "approved" ? "Approved" : "Rejected"} by {r.decider_name}
                {r.decided_at ? ` · ${formatIst(r.decided_at)}` : ""}
                {r.decision_note ? ` — “${r.decision_note}”` : ""}
              </>
            )}
          </div>
          {/* What the requester asked for, so a lead sees it before deciding. */}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <TaskPriorityBadge priority={r.priority ?? "medium"} />
            {r.estimated_hours != null && <span>Est. {r.estimated_hours}h</span>}
            {(r.start_date || r.due_date) && (
              <span>
                {r.start_date ? formatDate(r.start_date) : "Any time"} →{" "}
                {r.due_date ? formatDate(r.due_date) : "no deadline"}
              </span>
            )}
          </div>
        </div>
        {r.status === "approved" && r.task_id && (
          <button
            onClick={() => onOpenTask(r.task_id!)}
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-slate-50"
          >
            Open task
          </button>
        )}
        {r.status === "pending" && writable && (
          <div className="flex shrink-0 gap-2">
            {/* Nobody decides their own request, except an admin. */}
            {canManage && (!mine || isAdmin) && (
              <>
                <button
                  onClick={() => setDeciding({ request: r, mode: "approve" })}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  Approve
                </button>
                <button
                  onClick={() => setDeciding({ request: r, mode: "reject" })}
                  className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Reject
                </button>
              </>
            )}
            {mine && (
              <button
                onClick={() => withdraw(r)}
                className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Withdraw
              </button>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <>
      {requests.length > 0 && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">
              Task requests
              {pending.length > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {pending.length} awaiting approval
                </span>
              )}
            </h2>
            {decided.length > 0 && (
              <button
                onClick={() => setShowDecided((v) => !v)}
                aria-expanded={showDecided}
                className="text-xs font-medium text-slate-600 hover:text-slate-700"
              >
                {showDecided ? "Hide" : "Show"} decided ({decided.length})
              </button>
            )}
          </div>
          {pending.length === 0 && !showDecided ? (
            <p className="text-xs text-slate-500">No requests awaiting approval.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pending.map(renderRow)}
              {showDecided && decided.map(renderRow)}
            </ul>
          )}
        </section>
      )}

      {raiseOpen && (
        <RaiseRequestModal
          projectId={projectId}
          onClose={() => onRaiseOpenChange(false)}
          onRaised={(r) => {
            onRequestsChange([r, ...requests]);
            onRaiseOpenChange(false);
            toast("Request raised — a project lead will review it");
          }}
        />
      )}

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={viewing.title} widthClass="max-w-2xl">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <WorkTypeBadge type={viewing.task_type} />
            <RequestStatusBadge status={viewing.status} pendingLabel="Awaiting approval" />
          </div>
          <p className="mb-3 text-xs text-slate-600">
            Raised by {viewing.requester_name ?? "—"} on {formatIst(viewing.requested_at)}
            {viewing.decided_at &&
              ` · ${viewing.status === "approved" ? "Approved" : "Rejected"} by ${
                viewing.decider_name ?? "—"
              } on ${formatIst(viewing.decided_at)}`}
          </p>
          {viewing.decision_note && (
            <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-medium">Decision note:</span> {viewing.decision_note}
            </p>
          )}
          <SpecView item={viewing} />
        </Modal>
      )}

      {deciding && (
        <DecisionModal
          request={deciding.request}
          mode={deciding.mode}
          members={members}
          onClose={() => setDeciding(null)}
          onConflict={() => {
            setDeciding(null);
            onStale();
          }}
          onDecided={(request, task) => {
            replace(request);
            if (task) onTaskCreated(task);
            setDeciding(null);
            toast(task ? "Request approved — task created" : "Request rejected");
          }}
        />
      )}
    </>
  );
}

function RaiseRequestModal({
  projectId,
  onClose,
  onRaised,
}: {
  projectId: number;
  onClose: () => void;
  onRaised: (r: TaskRequest) => void;
}) {
  const [type, setType] = useState<SpecType>("correction");
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState<SpecColumns>(pickSpec(null));
  // Urgency and effort come from the person asking, not the approver.
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ request: TaskRequest }>(
        `/api/projects/${projectId}/requests`,
        {
          method: "POST",
          body: JSON.stringify({
            taskType: type,
            title,
            priority,
            estimatedHours: estimatedHours.trim() || null,
            startDate: startDate || null,
            dueDate: dueDate || null,
            ...specPayload(type, spec),
          }),
        }
      );
      onRaised(res.request);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not raise request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Raise a task request" widthClass="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          A project lead reviews your request, assigns an owner and approves it before
          work starts.
        </p>
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <WorkSpecFields
          type={type}
          onTypeChange={setType}
          spec={spec}
          onSpecChange={setSpec}
        />
        <div>
          <label htmlFor="request-title" className="mb-1 block text-sm font-medium text-slate-700">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            id="request-title"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* You know how urgent your own request is, and roughly what it takes.
            The lead can adjust when approving, but shouldn't have to guess. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="request-priority"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Priority
            </label>
            <select
              id="request-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className={inputClass}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="request-hours"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Estimated hours
            </label>
            <input
              id="request-hours"
              type="number"
              min="0"
              step="0.5"
              inputMode="decimal"
              placeholder="e.g. 4"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {/* When the work can start and when it is needed by. Either end can be
            left blank — a request with no dates is still a valid request. */}
        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-slate-700">
            Dates
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="request-start"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                From
              </label>
              <input
                id="request-start"
                type="date"
                value={startDate}
                max={dueDate || undefined}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="request-due"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                To (needed by)
              </label>
              <input
                id="request-due"
                type="date"
                value={dueDate}
                min={startDate || undefined}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </fieldset>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Sending…" : "Raise request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DecisionModal({
  request,
  mode,
  members,
  onClose,
  onConflict,
  onDecided,
}: {
  request: TaskRequest;
  mode: "approve" | "reject";
  members: ProjectMember[];
  onClose: () => void;
  onConflict: () => void;
  onDecided: (request: TaskRequest, task: Task | null) => void;
}) {
  const [assigneeId, setAssigneeId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const approving = mode === "approve";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ request: TaskRequest; task: Task | null }>(
        `/api/requests/${request.id}/decision`,
        {
          method: "POST",
          body: JSON.stringify(
            approving
              ? {
                  // Only the owner and an optional note. Priority, dates and
                  // effort come from the request itself.
                  decision: "approve",
                  assigneeId: assigneeId ? Number(assigneeId) : null,
                  note: note || null,
                }
              : { decision: "reject", note }
          ),
        }
      );
      onDecided(res.request, res.task);
    } catch (err) {
      // Already decided/withdrawn by someone else: close and show the current list.
      if (isConflict(err)) onConflict();
      setError(err instanceof Error ? err.message : "Could not save decision");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={approving ? "Approve request" : "Reject request"}
      widthClass="max-w-2xl"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">{request.title}</span>
            <WorkTypeBadge type={request.task_type} />
          </div>
          <p className="mb-2 text-xs text-slate-600">
            Raised by {request.requester_name ?? "—"} on {formatIst(request.requested_at)}
          </p>
          <SpecView item={request} compact />
        </div>

        {approving ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="decide-owner" className="mb-1 block text-sm font-medium text-slate-700">
                Assigned owner <span className="text-red-500">*</span>
              </label>
              <select
                id="decide-owner"
                required
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className={inputClass}
              >
                <option value="">Choose an owner…</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            {/* Priority, dates and effort belong to the person who asked for
                the work. Shown here so nobody approves something without
                seeing what they are agreeing to, but not editable: changing
                them is a conversation with the requester, not a silent edit
                at the moment of approval. */}
            <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-medium">As requested:</span>{" "}
              {PRIORITY_WORD[request.priority ?? "medium"]} priority
              {request.estimated_hours != null && ` · ${request.estimated_hours}h estimated`}
              {(request.start_date || request.due_date) &&
                ` · ${request.start_date ? formatDate(request.start_date) : "any time"} → ${
                  request.due_date ? formatDate(request.due_date) : "no deadline"
                }`}
            </div>
            <div>
              <label htmlFor="decide-note" className="mb-1 block text-sm font-medium text-slate-700">
                Note <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                id="decide-note"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="decide-reason" className="mb-1 block text-sm font-medium text-slate-700">
              Reason for rejecting <span className="text-red-500">*</span>
            </label>
            <textarea
              id="decide-reason"
              required
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
              approving ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {busy ? "Saving…" : approving ? "Approve & create task" : "Reject request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
