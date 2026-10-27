"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { RequestStatusBadge, TaskPriorityBadge, WorkTypeBadge } from "@/components/Badge";
import Avatar from "@/components/Avatar";
import { apiFetch, isConflict } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatIst } from "@/lib/tz";
import { formatDate } from "@/lib/format";
import type { ProjectMember, Task, TaskPriority, TaskRequest } from "@/lib/types";
import { checklistFor } from "@/lib/workflow";
import { SpecView } from "./WorkSpec";
import { pointsOf } from "./PointsInput";
import { FileLinks } from "@/components/work/AttachFiles";

const PRIORITY_WORD: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/**
 * What a request asks for: a specified request's specification, a quick
 * one's description and steps.
 */
function RequestBody({ request, compact = false }: { request: TaskRequest; compact?: boolean }) {
  const steps = pointsOf(request.steps);
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {request.description && (
        <p className="whitespace-pre-wrap text-sm text-slate-700">{request.description}</p>
      )}
      <SpecView item={request} compact={compact} hideEmpty={compact} />
      {steps.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Steps</p>
          <div className="mt-0.5 space-y-0.5 text-sm text-slate-700">
            {steps.map((s, i) => (
              <p key={i} className="flex gap-1.5">
                <span aria-hidden="true" className="text-slate-400">☐</span>
                <span>{s}</span>
              </p>
            ))}
          </div>
        </div>
      )}
      {!request.description && !steps.length && request.task_type === "general" && (
        <p className="text-sm text-slate-500">Just the title — no description or steps.</p>
      )}
      {(request.attachments?.length ?? 0) > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Files</p>
          <FileLinks files={request.attachments!} base="/api/request-attachments" />
        </div>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/**
 * Task requests from project members (sent from the task form). An admin/lead
 * approves one — choosing the assigned owner, which creates the task — or
 * rejects it with a reason. The asker may withdraw a request while it is
 * pending.
 */
export default function TaskRequestsPanel({
  requests,
  onRequestsChange,
  members,
  currentUserId,
  isAdmin,
  canManage,
  writable,
  onTaskCreated,
  onOpenTask,
  onStale,
}: {
  requests: TaskRequest[];
  onRequestsChange: (requests: TaskRequest[]) => void;
  members: ProjectMember[];
  currentUserId: number;
  isAdmin: boolean;
  canManage: boolean;
  writable: boolean;
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

  if (requests.length === 0) return null;

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
            {(r.attachments?.length ?? 0) > 0 && (
              <span className="text-xs text-slate-500" title="Files sent with this request">
                📎 {r.attachments!.length}
              </span>
            )}
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
            {/* DECIMAL out of MySQL reads "6.00"; nobody writes six hours that way. */}
            {r.estimated_hours != null && <span>Est. {Number(r.estimated_hours)}h</span>}
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
          <RequestBody request={viewing} />
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
  // What the task will start with, counted from the request itself.
  const checklistItemCount = checklistFor(request.task_type, request, request.steps).length;

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
        {/* What is being decided, laid out to be read: who asked, when it
            is wanted, and exactly what they asked for. */}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <WorkTypeBadge type={request.task_type} />
              <TaskPriorityBadge priority={request.priority ?? "medium"} />
            </div>
            <h3 className="text-base font-semibold text-slate-900">{request.title}</h3>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <Avatar name={request.requester_name ?? "?"} size="sm" />
              <span>
                <span className="font-medium text-slate-700">
                  {request.requester_name ?? "—"}
                </span>{" "}
                asked for this on {formatIst(request.requested_at)}
              </span>
            </div>
          </div>

          {/* Set by the requester. Shown, never editable here: changing
              someone's deadline is a conversation, not a silent edit at
              the moment of approval. */}
          <dl className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 text-center">
            {[
              {
                label: "Priority",
                value: PRIORITY_WORD[request.priority ?? "medium"],
              },
              {
                label: "Effort",
                value:
                  request.estimated_hours != null
                    ? `${Number(request.estimated_hours)}h`
                    : "Not estimated",
              },
              {
                label: "Wanted",
                value:
                  request.start_date || request.due_date
                    ? `${
                        request.start_date ? formatDate(request.start_date) : "any time"
                      } → ${
                        request.due_date ? formatDate(request.due_date) : "no deadline"
                      }`
                    : "No dates given",
              },
            ].map((cell) => (
              <div key={cell.label} className="px-2 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {cell.label}
                </dt>
                <dd className="mt-0.5 text-sm font-medium text-slate-800">{cell.value}</dd>
              </div>
            ))}
          </dl>

          <div className="px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              What was asked for
            </p>
            <RequestBody request={request} compact />
          </div>

          {/* What approving actually does, before it is done. */}
          {approving && (
            <p className="border-t border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
              ✅ Approving creates the task{" "}
              {checklistItemCount > 0 ? (
                <>
                  with a <strong>{checklistItemCount}-item checklist</strong> built from
                  the points above
                </>
              ) : (
                <>with no checklist — this request lists no points to tick off</>
              )}
              , owned by whoever you pick below.
              {(request.attachments?.length ?? 0) > 0 &&
                ` Its ${request.attachments!.length === 1 ? "file moves" : `${request.attachments!.length} files move`} to the task.`}{" "}
              {request.requester_name ?? "The requester"} signs it off at the end.
            </p>
          )}
        </div>

        {approving ? (
          // The one decision this dialog is for, given its own panel: who is
          // going to do it. Everything above is context for that choice.
          <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-4">
            <label
              htmlFor="decide-owner"
              className="mb-1 block text-sm font-semibold text-slate-800"
            >
              Who should do this? <span className="text-red-500">*</span>
            </label>
            <p className="mb-2 text-xs text-slate-600">
              The one thing you decide here. Priority, effort and dates came with the
              request and are accepted as they stand.
            </p>
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

            <label
              htmlFor="decide-note"
              className="mb-1 mt-3 block text-sm font-medium text-slate-700"
            >
              Note <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input
              id="decide-note"
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the owner should know before starting"
              className={inputClass}
            />
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
