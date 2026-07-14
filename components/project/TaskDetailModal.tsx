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
import { formatHM, formatMinutes, formatIst } from "@/lib/tz";

interface TimeLog {
  id: number;
  minutes: number;
  note: string | null;
  logged_at: string;
  user_id: number | null;
  user_name: string | null;
}
import {
  TASK_STATUS_LABELS,
  type Attachment,
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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [logH, setLogH] = useState("");
  const [logM, setLogM] = useState("");
  const [logNote, setLogNote] = useState("");
  const [savingLog, setSavingLog] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
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
        const [c, s, d, tl, at] = await Promise.all([
          apiFetch<{ comments: Comment[] }>(`/api/tasks/${task.id}/comments`),
          apiFetch<{ subtasks: Subtask[] }>(`/api/tasks/${task.id}/subtasks`),
          apiFetch<{ dependencies: Dependency[] }>(
            `/api/tasks/${task.id}/dependencies`
          ),
          apiFetch<{ logs: TimeLog[] }>(`/api/tasks/${task.id}/time-logs`),
          apiFetch<{ attachments: Attachment[] }>(
            `/api/tasks/${task.id}/attachments`
          ),
        ]);
        if (active) {
          setComments(c.comments);
          setSubtasks(s.subtasks);
          setDeps(d.dependencies);
          setTimeLogs(tl.logs);
          setAttachments(at.attachments);
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
    estimated_hours: currentTask.estimated_hours,
    spent_hours: currentTask.spent_hours,
  });

  const totalMinutes = timeLogs.reduce((s, l) => s + l.minutes, 0);

  async function logTime() {
    const minutes =
      (parseInt(logH || "0", 10) || 0) * 60 + (parseInt(logM || "0", 10) || 0);
    if (minutes <= 0) return;
    setSavingLog(true);
    try {
      const res = await apiFetch<{
        log: TimeLog;
        totalMinutes: number;
        status: string;
      }>(`/api/tasks/${currentTask.id}/time-logs`, {
        method: "POST",
        body: JSON.stringify({ minutes, note: logNote || null }),
      });
      setTimeLogs((prev) => [res.log, ...prev]);
      setLogH("");
      setLogM("");
      setLogNote("");
      onChanged({
        ...currentTask,
        spent_hours: res.totalMinutes / 60,
        status: res.status as TaskStatus,
      });
      toast("Time logged");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log time");
    } finally {
      setSavingLog(false);
    }
  }

  async function deleteLog(logId: number) {
    try {
      const res = await apiFetch<{ totalMinutes: number; status: string }>(
        `/api/tasks/${currentTask.id}/time-logs?logId=${logId}`,
        { method: "DELETE" }
      );
      setTimeLogs((prev) => prev.filter((l) => l.id !== logId));
      onChanged({
        ...currentTask,
        spent_hours: res.totalMinutes / 60,
        status: res.status as TaskStatus,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove entry", "error");
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

  async function saveEditComment(commentId: number) {
    if (!editBody.trim()) return;
    try {
      const res = await apiFetch<{ comment: Comment }>(
        `/api/comments/${commentId}`,
        { method: "PATCH", body: JSON.stringify({ body: editBody }) }
      );
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? res.comment : c))
      );
      setEditingId(null);
      setEditBody("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not edit comment", "error");
    }
  }

  async function deleteComment(commentId: number) {
    try {
      await apiFetch(`/api/comments/${commentId}`, { method: "DELETE" });
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      onChanged({
        ...currentTask,
        comment_count: Math.max(0, (currentTask.comment_count ?? 1) - 1),
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete comment", "error");
    }
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/tasks/${currentTask.id}/attachments`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setAttachments((prev) => [data.attachment, ...prev]);
      toast("File attached");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function deleteAttachment(attId: number) {
    try {
      await apiFetch(`/api/attachments/${attId}`, { method: "DELETE" });
      setAttachments((prev) => prev.filter((a) => a.id !== attId));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove file", "error");
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

      {/* Time log */}
      {(() => {
        const estMin =
          currentTask.estimated_hours != null
            ? Math.round(Number(currentTask.estimated_hours) * 60)
            : 0;
        const over = estMin > 0 && totalMinutes > estMin;
        const pct = estMin > 0 ? (totalMinutes / estMin) * 100 : 0;
        return (
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <span className="font-medium text-slate-700">Time</span>
                <span className="ml-2 text-slate-500">
                  {formatMinutes(totalMinutes)} logged
                  {estMin > 0 ? ` of ${formatHM(currentTask.estimated_hours)} est.` : ""}
                </span>
              </div>
              {over && (
                <span className="text-xs font-medium text-amber-600">
                  Over by {formatMinutes(totalMinutes - estMin)}
                </span>
              )}
            </div>
            {estMin > 0 && (
              <div className="mt-2">
                <ProgressBar value={pct} tone={over ? "green" : "indigo"} />
              </div>
            )}

            {canEditExecution && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className="block text-xs text-slate-500">Hours</label>
                  <input
                    type="number"
                    min="0"
                    value={logH}
                    onChange={(e) => setLogH(e.target.value)}
                    placeholder="0"
                    className="w-16 rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Minutes</label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={logM}
                    onChange={(e) => setLogM(e.target.value)}
                    placeholder="0"
                    className="w-16 rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <input
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                  placeholder="Note (optional)"
                  className="min-w-32 flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <button
                  onClick={logTime}
                  disabled={savingLog || (!logH && !logM)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  {savingLog ? "Adding…" : "Log time"}
                </button>
              </div>
            )}

            {timeLogs.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-slate-200 pt-2">
                {timeLogs.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-700">
                      {formatMinutes(l.minutes)}
                    </span>
                    <span className="text-slate-400">{l.user_name ?? "—"}</span>
                    {l.note && <span className="text-slate-500">· {l.note}</span>}
                    <span className="ml-auto text-slate-400">
                      {formatIst(l.logged_at)}
                    </span>
                    {(canManage || l.user_id === currentUser.id) && (
                      <button
                        onClick={() => deleteLog(l.id)}
                        className="text-slate-300 hover:text-red-500"
                        aria-label="Remove entry"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}

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
                {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[])
                  .filter((s) => canManage || s !== "done")
                  .map((s) => (
                    <option key={s} value={s}>
                      {!canManage && s === "review"
                        ? "Review (submit)"
                        : TASK_STATUS_LABELS[s]}
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

      {/* Attachments */}
      <div className="mt-6 border-t border-slate-100 pt-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          Attachments ({attachments.length})
        </h3>
        {attachments.length > 0 && (
          <ul className="mb-3 space-y-1">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm"
              >
                <span className="text-slate-400">📎</span>
                <a
                  href={`/api/attachments/${a.id}`}
                  className="truncate font-medium text-indigo-600 hover:underline"
                >
                  {a.filename}
                </a>
                <span className="text-xs text-slate-400">
                  {fmtBytes(Number(a.size_bytes))}
                  {a.uploader_name ? ` · ${a.uploader_name}` : ""}
                </span>
                {(canManage || a.uploaded_by === currentUser.id) && (
                  <button
                    onClick={() => deleteAttachment(a.id)}
                    className="ml-auto text-xs text-slate-300 hover:text-red-500"
                    aria-label="Remove attachment"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {uploading ? "Uploading…" : "+ Attach file"}
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
              e.target.value = "";
            }}
          />
        </label>
        <span className="ml-2 text-xs text-slate-400">Max 10 MB</span>
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
            {comments.map((c) => {
              const mine = c.user_id === currentUser.id;
              const canDel = mine || canManage;
              return (
                <li key={c.id} className="flex gap-2">
                  <Avatar name={c.user_name ?? "?"} size="sm" />
                  <div className="flex-1 rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">
                        {c.user_name}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatRelative(c.created_at)}
                        {c.edited_at ? " · edited" : ""}
                      </span>
                    </div>
                    {editingId === c.id ? (
                      <div className="mt-1 flex gap-2">
                        <input
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                        />
                        <button
                          onClick={() => saveEditComment(c.id)}
                          className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setEditBody("");
                          }}
                          className="text-xs text-slate-400 hover:text-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                          {c.body}
                        </p>
                        {canDel && (
                          <div className="mt-1 flex gap-3 text-xs text-slate-400">
                            {mine && (
                              <button
                                onClick={() => {
                                  setEditingId(c.id);
                                  setEditBody(c.body);
                                }}
                                className="hover:text-indigo-600"
                              >
                                Edit
                              </button>
                            )}
                            <button
                              onClick={() => deleteComment(c.id)}
                              className="hover:text-red-500"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
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
