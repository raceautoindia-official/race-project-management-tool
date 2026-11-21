"use client";

import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { apiFetch } from "@/lib/api-client";
import { canSignOff, isOwnWork, signOffBlockers } from "@/lib/workflow";
import type { Role, Task } from "@/lib/types";

/**
 * The sign-off step, in one obvious place: a banner at the top of a task
 * (its page and its pop-up) once it is Done and not yet signed off.
 *
 * - Someone who can sign it off (the requester, a project lead or owner, an
 *   admin) gets the Sign off button right here, with the note and the
 *   confirmation opening in place.
 * - Everyone else sees who it is waiting for, so nobody hunts for a button
 *   they don't have.
 */
export default function SignOffBanner({
  task,
  currentUser,
  canManage,
  readOnly = false,
  onSigned,
  autoOpen = false,
}: {
  task: Task;
  currentUser: { id: number; role: Role };
  /** Admin, or the project's owner / a lead. */
  canManage: boolean;
  /** The project is locked. */
  readOnly?: boolean;
  onSigned: (task: Task) => void;
  /** Arrived from a "please sign off" link: open the confirmation at once. */
  autoOpen?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(autoOpen);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (task.status !== "done" || task.signed_off_at || readOnly) return null;

  const may = canSignOff(currentUser, canManage, task);
  const missing = signOffBlockers(task, { signerIsManager: canManage });
  const who = task.assignee_name ?? "Its owner";

  if (!may) {
    const waitingFor = isOwnWork(currentUser, task)
      ? "a project lead or an admin — you can't sign off your own work"
      : task.requester_name
        ? `${task.requester_name} (who asked for it), a project lead or an admin`
        : "a project lead or an admin";
    return (
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <span aria-hidden>✍ </span>
        <strong>Done — waiting for sign-off</strong> by {waitingFor}.
      </div>
    );
  }

  async function signOff() {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ task: Task }>(`/api/tasks/${task.id}/signoff`, {
        method: "POST",
        body: JSON.stringify({ note: note || null }),
      });
      toast("Signed off — this task is now read-only");
      onSigned(res.task);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign off");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4" role="region" aria-label="Sign off this task">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-base text-white" aria-hidden>
          ✍
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-semibold text-slate-900">Ready for your sign-off</p>
          <p className="text-sm text-slate-700">
            {who} finished this and it was approved. Check the work, then sign it off — that locks the task for good.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            Sign off
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3">
          {missing.length > 0 ? (
            <>
              <p className="text-sm text-slate-700">These are needed before it can be signed off:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-red-700">
                {missing.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-700">
                Confirm the work meets its {task.task_type === "correction" ? "acceptance criteria" : "specification"}. Signing off makes this
                task and everything on it <strong>permanently read-only</strong>.
              </p>
              <label htmlFor={`signoff-note-${task.id}`} className="mt-2 block text-xs text-slate-600">
                Note (optional)
              </label>
              <textarea
                id={`signoff-note-${task.id}`}
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </>
          )}
          {error && (
            <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Not yet
            </button>
            <button
              type="button"
              onClick={signOff}
              disabled={busy || missing.length > 0}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Signing off…" : "Confirm sign-off"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
