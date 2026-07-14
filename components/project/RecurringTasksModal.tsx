"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatDate } from "@/lib/format";
import {
  type ProjectMember,
  type RecurringTask,
  type TaskPriority,
} from "@/lib/types";

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/**
 * Manage a project's recurring-task definitions. A definition materialises into
 * a real task each interval (via /api/cron/recurring), so this is a template
 * for repeating work — not a task itself.
 */
export default function RecurringTasksModal({
  open,
  onClose,
  projectId,
  members,
  canManage,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  members: ProjectMember[];
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<RecurringTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [recurrence, setRecurrence] = useState<"daily" | "weekly" | "monthly">(
    "weekly"
  );
  const [nextRun, setNextRun] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch<{ recurring: RecurringTask[] }>(
      `/api/projects/${projectId}/recurring`
    )
      .then((r) => setItems(r.recurring))
      .catch((e) =>
        toast(e instanceof Error ? e.message : "Could not load", "error")
      )
      .finally(() => setLoading(false));
  }, [open, projectId, toast]);

  async function create() {
    if (!title.trim() || !nextRun) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ recurring: RecurringTask }>(
        `/api/projects/${projectId}/recurring`,
        {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            priority,
            assigneeId: assigneeId || null,
            estimatedHours: estimatedHours || null,
            recurrence,
            nextRun,
          }),
        }
      );
      setItems((prev) => [res.recurring, ...prev]);
      setTitle("");
      setDescription("");
      setEstimatedHours("");
      setAssigneeId("");
      toast("Recurring task added");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: RecurringTask) {
    try {
      const res = await apiFetch<{ recurring: RecurringTask }>(
        `/api/recurring/${item.id}`,
        { method: "PATCH", body: JSON.stringify({ isActive: !item.is_active }) }
      );
      setItems((prev) => prev.map((x) => (x.id === item.id ? res.recurring : x)));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update", "error");
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this recurring task? Existing tasks are kept.")) return;
    try {
      await apiFetch(`/api/recurring/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
    }
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none";

  return (
    <Modal open={open} onClose={onClose} title="Recurring tasks" widthClass="max-w-2xl">
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400">No recurring tasks yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-slate-100">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-medium ${
                      it.is_active ? "text-slate-800" : "text-slate-400 line-through"
                    }`}
                  >
                    {it.title}
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
                    {RECURRENCE_LABELS[it.recurrence] ?? it.recurrence}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  Next: {formatDate(it.next_run)}
                  {it.assignee_name ? ` · ${it.assignee_name}` : ""}
                  {` · ${it.priority}`}
                </div>
              </div>
              {canManage && (
                <>
                  <button
                    onClick={() => toggle(it)}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    {it.is_active ? "Pause" : "Resume"}
                  </button>
                  <button
                    onClick={() => remove(it.id)}
                    className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <div className="text-sm font-semibold text-slate-700">New recurring task</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className={inputClass}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className={inputClass}
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-slate-500">
              Repeat
              <select
                value={recurrence}
                onChange={(e) =>
                  setRecurrence(e.target.value as "daily" | "weekly" | "monthly")
                }
                className={inputClass}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">
              First run
              <input
                type="date"
                value={nextRun}
                onChange={(e) => setNextRun(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-xs text-slate-500">
              Priority
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className={inputClass}
              >
                {(["low", "medium", "high", "urgent"] as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Est. hours
              <input
                type="number"
                min="0"
                step="0.5"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <label className="block text-xs text-slate-500">
            Assignee
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className={inputClass}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={create}
            disabled={busy || !title.trim() || !nextRun}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Add recurring task
          </button>
        </div>
      )}
    </Modal>
  );
}
