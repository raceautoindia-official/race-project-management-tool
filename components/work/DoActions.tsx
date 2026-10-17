"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { apiFetch } from "@/lib/api-client";
import { reviewsChanged } from "./review-count";

/**
 * Start / Mark complete for one item on my to-do list, without opening it.
 *   subtask → POST /api/subtasks/:id/actions { action: start | submit }
 *             (the task owner's own subtask is approved at once)
 *   task    → PATCH /api/tasks/:id { status: in_progress | review }
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

  async function run(step: "start" | "finish") {
    setBusy(true);
    try {
      let message: string;
      if (kind === "subtask") {
        const res = await apiFetch<{ status: string }>(`/api/subtasks/${id}/actions`, {
          method: "POST",
          body: JSON.stringify({ action: step === "start" ? "start" : "submit" }),
        });
        message = step === "start" ? `Started “${title}”` : res.status === "done" ? `“${title}” is done and approved` : `Sent “${title}” to its task owner for review`;
      } else {
        await apiFetch(`/api/tasks/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: step === "start" ? "in_progress" : "review" }),
        });
        message = step === "start" ? `Started “${title}”` : `Sent “${title}” for review`;
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
      {status === "todo" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run("start")}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          ▶ Start
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => run("finish")}
        aria-label={`Mark “${title}” complete`}
        className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {kind === "task" ? "Send for review" : "✓ Mark complete"}
      </button>
    </span>
  );
}
