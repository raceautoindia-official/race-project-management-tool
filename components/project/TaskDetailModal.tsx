"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { TaskStatusBadge, TaskPriorityBadge } from "@/components/Badge";
import LabelChip from "@/components/LabelChip";
import Avatar from "@/components/Avatar";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { ProgressBar } from "@/components/ProgressBar";
import { taskProgress } from "@/lib/progress";
import { formatDate, formatRelative, isOverdue } from "@/lib/format";
import {
  TASK_STATUS_LABELS,
  type Comment,
  type ProjectMember,
  type Role,
  type Subtask,
  type Task,
  type TaskStatus,
} from "@/lib/types";

interface Dependency {
  id: number;
  title: string;
  status: TaskStatus;
  done: boolean;
}

export default function TaskDetailModal({
  open,
  onClose,
  task,
  currentUser,
  canManage,
  members,
  projectTasks,
  onEdit,
  onAddFollowUp,
  onChanged,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  task: Task | null;
  currentUser: { id: number; role: Role };
  canManage: boolean;
  members: ProjectMember[];
  projectTasks: { id: number; title: string; status: TaskStatus }[];
  onEdit: (task: Task) => void;
  onAddFollowUp: (task: Task) => void;
  onChanged: (task: Task) => void;
  onDeleted: (taskId: number) => void;
}) {
  const { toast } = useToast();
  const [comments, setComments] = useState<Comment[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [depToAdd, setDepToAdd] = useState("");
  const [newSub, setNewSub] = useState("");
  const [body, setBody] = useState("");
  // @mention state
  const [picked, setPicked] = useState<{ id: number; name: string }[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [spent, setSpent] = useState<string>(
    task?.spent_hours != null ? String(task.spent_hours) : "0"
  );
  const [savingHours, setSavingHours] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The parent keys this modal by task id, so it remounts per task and the
  // fetches below run once on mount. All state updates happen after `await`.
  useEffect(() => {
    if (!task) return;
    let active = true;
    (async () => {
      try {
        const [c, s, d] = await Promise.all([
          apiFetch<{ comments: Comment[] }>(`/api/tasks/${task.id}/comments`),
          apiFetch<{ subtasks: Subtask[] }>(`/api/tasks/${task.id}/subtasks`),
          apiFetch<{ dependencies: Dependency[] }>(
            `/api/tasks/${task.id}/dependencies`
          ),
        ]);
        if (active) {
          setComments(c.comments);
          setSubtasks(s.subtasks);
          setDeps(d.dependencies);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [task]);

  if (!task) return null;
  const currentTask = task;

  const isAssignee = currentTask.assignee_id === currentUser.id;
  // Managers (admin/lead) manage everything; the assignee may drive execution
  // (status, checklist, logged hours) on their own task.
  const canEditExecution = canManage || isAssignee;
  const canDelete = canManage;
  const overdue = isOverdue(currentTask.due_date, currentTask.status);
  const subDone = subtasks.filter((s) => s.is_done).length;
  const subPct = subtasks.length
    ? Math.round((subDone / subtasks.length) * 100)
    : 0;
  const progress = taskProgress({
    status: currentTask.status,
    subtask_total: subtasks.length,
    subtask_done: subDone,
  });

  async function saveHours() {
    setSavingHours(true);
    try {
      const res = await apiFetch<{ task: Task }>(`/api/tasks/${currentTask.id}`, {
        method: "PATCH",
        body: JSON.stringify({ spentHours: spent === "" ? 0 : Number(spent) }),
      });
      onChanged(res.task);
      toast("Hours logged");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log hours");
    } finally {
      setSavingHours(false);
    }
  }

  const blocked = deps.some((d) => !d.done);
  const depCandidates = projectTasks.filter(
    (t) => t.id !== currentTask.id && !deps.some((d) => d.id === t.id)
  );
  const mentionCandidates =
    mentionQuery == null
      ? []
      : members
          .filter((m) => m.user_id !== currentUser.id)
          .filter((m) =>
            m.name.toLowerCase().includes(mentionQuery.toLowerCase())
          )
          .slice(0, 6);

  async function addDependency() {
    if (!depToAdd) return;
    try {
      await apiFetch(`/api/tasks/${currentTask.id}/dependencies`, {
        method: "POST",
        body: JSON.stringify({ dependsOnTaskId: Number(depToAdd) }),
      });
      const t = projectTasks.find((x) => x.id === Number(depToAdd));
      if (t)
        setDeps((prev) => [
          ...prev,
          { id: t.id, title: t.title, status: t.status, done: t.status === "done" },
        ]);
      setDepToAdd("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add blocker", "error");
    }
  }
  async function removeDependency(depId: number) {
    try {
      await apiFetch(
        `/api/tasks/${currentTask.id}/dependencies?dependsOnTaskId=${depId}`,
        { method: "DELETE" }
      );
      setDeps((prev) => prev.filter((d) => d.id !== depId));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove blocker", "error");
    }
  }

  function onBodyChange(v: string) {
    setBody(v);
    const m = v.match(/@(\w*)$/);
    setMentionQuery(m ? m[1] : null);
  }
  function pickMention(m: ProjectMember) {
    setBody((prev) => prev.replace(/@(\w*)$/, `@${m.name} `));
    setPicked((prev) =>
      prev.some((p) => p.id === m.user_id)
        ? prev
        : [...prev, { id: m.user_id, name: m.name }]
    );
    setMentionQuery(null);
  }

  function syncCounts(list: Subtask[]) {
    onChanged({
      ...currentTask,
      subtask_total: list.length,
      subtask_done: list.filter((s) => s.is_done).length,
    });
  }

  async function changeStatus(status: TaskStatus) {
    if (status === currentTask.status) return;
    // Dependency warning: moving a blocked task forward.
    if (blocked && status !== "todo") {
      const unfinished = deps.filter((d) => !d.done).map((d) => d.title);
      if (
        !confirm(
          `This task is blocked by unfinished task(s):\n• ${unfinished.join(
            "\n• "
          )}\n\nContinue anyway?`
        )
      )
        return;
    }
    try {
      const res = await apiFetch<{ task: Task }>(`/api/tasks/${currentTask.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged(res.task);
      toast("Status updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update status");
    }
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const mentionIds = picked
      .filter((p) => body.includes("@" + p.name))
      .map((p) => p.id);
    try {
      const res = await apiFetch<{ comment: Comment }>(
        `/api/tasks/${currentTask.id}/comments`,
        { method: "POST", body: JSON.stringify({ body, mentionIds }) }
      );
      setComments((prev) => [...prev, res.comment]);
      setBody("");
      setPicked([]);
      setMentionQuery(null);
      onChanged({
        ...currentTask,
        comment_count: (currentTask.comment_count ?? 0) + 1,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add comment");
    } finally {
      setBusy(false);
    }
  }

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!newSub.trim()) return;
    try {
      const res = await apiFetch<{ subtask: Subtask }>(
        `/api/tasks/${currentTask.id}/subtasks`,
        { method: "POST", body: JSON.stringify({ title: newSub.trim() }) }
      );
      const list = [...subtasks, res.subtask];
      setSubtasks(list);
      setNewSub("");
      syncCounts(list);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add subtask", "error");
    }
  }

  async function toggleSubtask(s: Subtask) {
    try {
      const res = await apiFetch<{ subtask: Subtask }>(`/api/subtasks/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_done: !s.is_done }),
      });
      const list = subtasks.map((x) => (x.id === s.id ? res.subtask : x));
      setSubtasks(list);
      syncCounts(list);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update subtask", "error");
    }
  }

  async function deleteSubtask(id: number) {
    try {
      await apiFetch(`/api/subtasks/${id}`, { method: "DELETE" });
      const list = subtasks.filter((x) => x.id !== id);
      setSubtasks(list);
      syncCounts(list);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete subtask", "error");
    }
  }

  async function remove() {
    if (!confirm("Delete this task?")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/tasks/${currentTask.id}`, { method: "DELETE" });
      onDeleted(currentTask.id);
      toast("Task deleted");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete task");
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={currentTask.title} widthClass="max-w-2xl">
      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <TaskStatusBadge status={currentTask.status} />
        <TaskPriorityBadge priority={currentTask.priority} />
        {Boolean(currentTask.is_additional) && (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
            Additional work
          </span>
        )}
        {blocked && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            ⛔ Blocked
          </span>
        )}
        {currentTask.labels?.map((l) => (
          <LabelChip key={l.id} name={l.name} color={l.color} />
        ))}
        <div className="ml-auto flex gap-2">
          {canManage && currentTask.status === "done" && (
            <button
              onClick={() => onAddFollowUp(currentTask)}
              className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50"
            >
              + Follow-up work
            </button>
          )}
          {canManage && (
            <button
              onClick={() => onEdit(currentTask)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
        {currentTask.description || (
          <span className="text-slate-400">No description.</span>
        )}
      </p>

      {/* Progress */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>Progress</span>
          <span className="font-medium text-slate-600">{progress}%</span>
        </div>
        <ProgressBar
          value={progress}
          tone={currentTask.status === "done" ? "green" : "indigo"}
        />
      </div>

      {/* Effort (hours) */}
      <div className="mt-4 rounded-lg bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            <span className="font-medium text-slate-700">Effort</span>
            <span className="ml-2 text-slate-500">
              {currentTask.estimated_hours != null
                ? `${Number(currentTask.estimated_hours)}h estimated`
                : "No estimate"}
            </span>
          </div>
          {canEditExecution ? (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Logged</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={spent}
                onChange={(e) => setSpent(e.target.value)}
                className="w-20 rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <span className="text-xs text-slate-500">h</span>
              <button
                onClick={saveHours}
                disabled={savingHours || Number(spent) === Number(currentTask.spent_hours)}
                className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                {savingHours ? "Saving…" : "Log"}
              </button>
            </div>
          ) : (
            <span className="text-sm text-slate-500">
              {Number(currentTask.spent_hours)}h logged
            </span>
          )}
        </div>
        {currentTask.estimated_hours != null &&
          Number(currentTask.estimated_hours) > 0 && (
            <div className="mt-2">
              <ProgressBar
                value={
                  (Number(currentTask.spent_hours) /
                    Number(currentTask.estimated_hours)) *
                  100
                }
                tone={
                  Number(currentTask.spent_hours) >
                  Number(currentTask.estimated_hours)
                    ? "green"
                    : "indigo"
                }
              />
            </div>
          )}
      </div>

      {/* Blocked by (dependencies) */}
      {(deps.length > 0 || canManage) && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Blocked by</h3>
          {deps.length === 0 ? (
            <p className="text-xs text-slate-400">No dependencies.</p>
          ) : (
            <ul className="space-y-1">
              {deps.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      d.done ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className={d.done ? "text-slate-400 line-through" : "text-slate-700"}>
                    {d.title}
                  </span>
                  <span className="text-xs text-slate-400">
                    {TASK_STATUS_LABELS[d.status]}
                  </span>
                  {canManage && (
                    <button
                      onClick={() => removeDependency(d.id)}
                      className="ml-auto text-xs text-slate-300 hover:text-red-500"
                      aria-label="Remove blocker"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && depCandidates.length > 0 && (
            <div className="mt-2 flex gap-2">
              <select
                value={depToAdd}
                onChange={(e) => setDepToAdd(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              >
                <option value="">Add a blocking task…</option>
                {depCandidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <button
                onClick={addDependency}
                disabled={!depToAdd}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-400">Assignee</dt>
          <dd className="flex items-center gap-1.5 font-medium text-slate-700">
            {currentTask.assignee_name ? (
              <>
                <Avatar name={currentTask.assignee_name} size="sm" />
                {currentTask.assignee_name}
              </>
            ) : (
              "Unassigned"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Due date</dt>
          <dd className={`font-medium ${overdue ? "text-red-600" : "text-slate-700"}`}>
            {currentTask.due_date ? formatDate(currentTask.due_date) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Created by</dt>
          <dd className="font-medium text-slate-700">
            {currentTask.creator_name ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">
            {canEditExecution ? "Move to" : "Status"}
          </dt>
          <dd>
            {canEditExecution ? (
              <select
                value={currentTask.status}
                onChange={(e) => changeStatus(e.target.value as TaskStatus)}
                className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
              >
                {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-medium text-slate-700">
                {TASK_STATUS_LABELS[currentTask.status]}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {/* Subtasks / checklist */}
      <div className="mt-6 border-t border-slate-100 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            Checklist {subtasks.length > 0 && `(${subDone}/${subtasks.length})`}
          </h3>
        </div>
        {subtasks.length > 0 && (
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-green-500" style={{ width: `${subPct}%` }} />
          </div>
        )}
        <ul className="space-y-1">
          {subtasks.map((s) => (
            <li key={s.id} className="group flex items-center gap-2">
              <input
                type="checkbox"
                checked={s.is_done}
                disabled={!canEditExecution}
                onChange={() => toggleSubtask(s)}
                className="h-4 w-4 rounded border-slate-300 disabled:opacity-60"
              />
              <span
                className={`flex-1 text-sm ${
                  s.is_done ? "text-slate-400 line-through" : "text-slate-700"
                }`}
              >
                {s.title}
              </span>
              {canEditExecution && (
                <button
                  onClick={() => deleteSubtask(s.id)}
                  className="text-xs text-slate-300 hover:text-red-500"
                  aria-label="Delete subtask"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEditExecution && (
          <form onSubmit={addSubtask} className="mt-2 flex gap-2">
            <input
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              placeholder="Add a checklist item…"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newSub.trim()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Add
            </button>
          </form>
        )}
      </div>

      {/* Comments */}
      <div className="mt-6 border-t border-slate-100 pt-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          Comments ({comments.length})
        </h3>
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-slate-400">No comments yet.</p>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-2">
                <Avatar name={c.user_name ?? "?"} size="sm" />
                <div className="flex-1 rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">
                      {c.user_name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {formatRelative(c.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                    {c.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addComment} className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <input
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              placeholder="Write a comment… use @ to mention"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {mentionCandidates.length > 0 && (
              <div className="absolute bottom-full z-10 mb-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {mentionCandidates.map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => pickMention(m)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-indigo-50"
                  >
                    <span className="font-medium text-slate-700">{m.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </Modal>
  );
}
