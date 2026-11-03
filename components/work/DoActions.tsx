"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { apiFetch } from "@/lib/api-client";
import { reviewsChanged } from "./review-count";
import WorkButton from "./WorkButton";

/**
 * Start (the work timer) / Mark complete for one item on my to-do list,
 * without opening it.
 *   subtask → POST /api/subtasks/:id/actions { action: submit }
 *             (the task owner's own subtask is approved at once)
 *   task    → PATCH /api/tasks/:id { status: review }
 */
export default function DoActions({
  kind,
  id,
  status,
  title,
}: {
  kind: "subtask" | "task";
  id: number;
  status: string;
  title: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true);
    try {
      let message: string;
      if (kind === "subtask") {
        const res = await apiFetch<{ status: string }>(`/api/subtasks/${id}/actions`, {
          method: "POST",
          body: JSON.stringify({ action: "submit" }),
        });
        message = res.status === "done" ? `“${title}” is done and approved` : `Sent “${title}” to its task owner for review`;
      } else {
        await apiFetch(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status: "review" }) });
        message = `Sent “${title}” for review`;
      }
      toast(message);
      reviewsChanged();
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work — please try again", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex gap-1.5">
      {/* Starting runs the work timer (you must be clocked in on Attendance). */}
      <WorkButton
        taskId={kind === "task" ? id : undefined}
        subtaskId={kind === "subtask" ? id : undefined}
        status={status}
        title={title}
      />
      <button
        type="button"
        disabled={busy}
        onClick={finish}
        aria-label={`Mark “${title}” complete`}
        className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {kind === "task" ? "Send for review" : "✓ Mark complete"}
      </button>
    </span>
  );
}
