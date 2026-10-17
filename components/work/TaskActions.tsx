"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { apiFetch, isConflict } from "@/lib/api-client";
import { reviewsChanged } from "./review-count";

/**
 * What the current person can do with a task, in plain words, plus who acts
 * next — the task-level half of the flow (subtasks have theirs in
 * SubtasksPanel):
 *
 *   task owner (or a manager):  ▶ Start · Send for review
 *   project owner / lead / admin, task waiting for review:  ✓ Approve · ↩ Send back (with a note)
 *   everyone else:  "Waiting for … to approve" / "Goes for review when every subtask is approved"
 *
 * Approve / send back use /api/tasks/:id/approval; start / send use
 * PATCH /api/tasks/:id. `onChanged` re-reads the task afterwards.
 */
export default function TaskActions({
  task,
  currentUserId,
  isManager,
  readOnly,
  projectOwnerName,
  onChanged,
  size = "sm",
}: {
  task: {
    id: number;
    title: string;
    status: "todo" | "in_progress" | "review" | "done";
    assignee_id: number | null;
    assignee_name?: string | null;
    subtask_total?: number;
    subtask_done?: number;
    signed_off_at?: string | null;
  };
  currentUserId: number;
  isManager: boolean;
  readOnly: boolean;
  projectOwnerName: string | null;
  onChanged: () => void;
  size?: "sm" | "md";
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState("");

  const isOwner = task.assignee_id === currentUserId;
  const hasSubtasks = Number(task.subtask_total ?? 0) > 0;
  const allApproved = hasSubtasks && Number(task.subtask_done ?? 0) >= Number(task.subtask_total ?? 0);
  const btn = size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await work();
      toast(done);
      reviewsChanged();
      onChanged();
    } catch (e) {
      if (isConflict(e)) onChanged();
      toast(e instanceof Error ? e.message : "That didn't work — please try again", "error");
    } finally {
      setBusy(false);
    }
  }
  const patch = (status: string) =>
    apiFetch(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  const decide = (decision: "approve" | "reject", n?: string) =>
    apiFetch(`/api/tasks/${task.id}/approval`, { method: "POST", body: JSON.stringify({ decision, note: n || undefined }) });

  if (task.signed_off_at) return <span className="text-xs text-violet-700">🔒 Signed off — finished</span>;
  if (readOnly) return null;

  const parts: React.ReactNode[] = [];
  if (task.status === "review") {
    if (isManager) {
      parts.push(
        <button key="approve" type="button" disabled={busy} onClick={() => run(() => decide("approve"), `Approved — “${task.title}” now counts toward the project`)} className={`rounded-lg bg-emerald-600 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 ${btn}`}>
          ✓ Approve task
        </button>,
        <button key="back" type="button" disabled={busy} onClick={() => setSendingBack(true)} className={`rounded-lg border border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${btn}`}>
          ↩ Send back
        </button>
      );
    } else {
      parts.push(
        <span key="wait" className="text-xs text-amber-700">
          Waiting for {projectOwnerName ?? "the project owner"} (or a lead) to approve
        </span>
      );
    }
  } else if (task.status === "todo" || task.status === "in_progress") {
    const mayWork = isOwner || isManager;
    if (mayWork && task.status === "todo") {
      parts.push(
        <button key="start" type="button" disabled={busy} onClick={() => run(() => patch("in_progress"), `Started “${task.title}”`)} className={`rounded-lg border border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${btn}`}>
          ▶ Start
        </button>
      );
    }
    if (mayWork && (!hasSubtasks || allApproved)) {
      parts.push(
        <button
          key="send"
          type="button"
          disabled={busy}
          onClick={() => run(() => patch("review"), `Sent “${task.title}” to ${projectOwnerName ?? "the project owner"} for approval`)}
          title={`Sends it to ${projectOwnerName ?? "the project owner"} (or a lead) to approve.`}
          className={`rounded-lg bg-indigo-600 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 ${btn}`}
        >
          Send for review
        </button>
      );
    }
    if (hasSubtasks && !allApproved) {
      parts.push(
        <span key="auto" className="text-xs text-slate-500">
          Goes for review by itself when every subtask is approved ({task.subtask_done ?? 0}/{task.subtask_total})
        </span>
      );
    }
  } else if (task.status === "done") {
    parts.push(<span key="done" className="text-xs text-green-700">✓ Approved — waiting for the requester to sign off</span>);
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {parts}
      <Modal open={sendingBack} onClose={() => setSendingBack(false)} title="Send the task back">
        <p className="mb-3 text-sm text-slate-600">
          Tell {task.assignee_name ?? "the task owner"} what needs to change on <strong>{task.title}</strong>. It goes back to In progress.
        </p>
        <textarea
          autoFocus
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="What needs to change"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="e.g. The totals don't match the invoice — please recheck before sending again."
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setSendingBack(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={!note.trim() || busy}
            onClick={() =>
              void run(() => decide("reject", note.trim()), "Sent back with your note").then(() => {
                setSendingBack(false);
                setNote("");
              })
            }
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Send back
          </button>
        </div>
      </Modal>
    </span>
  );
}
