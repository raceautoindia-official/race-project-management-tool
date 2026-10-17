"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { apiFetch } from "@/lib/api-client";
import { reviewsChanged } from "./review-count";

/**
 * Approve / Request changes for one item waiting for my review.
 *   subtask → POST /api/subtasks/:id/actions  { action: approve | request_changes, note }
 *   task    → POST /api/tasks/:id/approval    { decision: approve | reject, note }
 * Sending back always asks for a note, so the person knows what to change.
 * Afterwards the page reloads its data (router.refresh) and the nav badge updates.
 */
export default function ReviewActions({
  kind,
  id,
  title,
  compact = false,
}: {
  kind: "subtask" | "task";
  id: number;
  title: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const noteId = useId();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      if (kind === "subtask") {
        await apiFetch(`/api/subtasks/${id}/actions`, {
          method: "POST",
          body: JSON.stringify(approve ? { action: "approve" } : { action: "request_changes", note: note.trim() }),
        });
      } else {
        await apiFetch(`/api/tasks/${id}/approval`, {
          method: "POST",
          body: JSON.stringify({ decision: approve ? "approve" : "reject", note: note.trim() || undefined }),
        });
      }
      toast(approve ? `Approved — “${title}” now counts toward progress` : `Sent back with your note`);
      setAsking(false);
      setNote("");
      reviewsChanged();
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work — please try again", "error");
    } finally {
      setBusy(false);
    }
  }

  const size = compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={busy}
        className={`rounded-lg border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${size}`}
        aria-label={`Request changes on ${title}`}
      >
        Request changes
      </button>
      <button
        type="button"
        onClick={() => decide(true)}
        disabled={busy}
        className={`rounded-lg bg-green-600 font-semibold text-white hover:bg-green-700 disabled:opacity-50 ${size}`}
        aria-label={`Approve ${title}`}
      >
        {busy && !asking ? "Saving…" : "✓ Approve"}
      </button>

      <Modal open={asking} onClose={() => !busy && setAsking(false)} title="Request changes">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) decide(false);
          }}
        >
          <p className="mb-3 text-sm text-slate-600">
            <strong className="text-slate-800">{title}</strong> goes back to its assignee. Tell them what needs to change — they
            will see your note.
          </p>
          <label htmlFor={noteId} className="mb-1 block text-sm font-medium text-slate-700">
            What needs to change?
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={1000}
            required
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !note.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send back"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
