"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import {
  ReadOnlyBadge,
  TaskStatusBadge,
  TaskPriorityBadge,
  WorkTypeBadge,
} from "@/components/Badge";
import LabelChip from "@/components/LabelChip";
import Avatar from "@/components/Avatar";
import { apiFetch, isConflict } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { ProgressBar } from "@/components/ProgressBar";
import { taskProgress } from "@/lib/progress";
import { formatDate, formatRelative, isOverdue } from "@/lib/format";
import { formatHM, formatMinutes, formatIst } from "@/lib/tz";
import {
  canSignOff,
  pendingChecklistItems,
  signOffBlockers,
  specFieldsFor,
} from "@/lib/workflow";
import { SpecView } from "./WorkSpec";

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
  projectReadOnlyReason,
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
  /** Set when the whole project is read-only (pending, rejected, completed). */
  projectReadOnlyReason: string | null;
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
  const [seedingSpec, setSeedingSpec] = useState(false);
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
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [signOffNote, setSignOffNote] = useState("");
  const [downloading, setDownloading] = useState(false);

  // The parent keys this modal by task id and open state, so it remounts each
  // time it opens and the fetches below run once per opening (not on every
  // task change). All state updates happen after `await`.
  const taskId = task?.id;
  useEffect(() => {
    if (!taskId || !open) return;
    let active = true;
    (async () => {
      try {
        const [c, s, d, tl, at] = await Promise.all([
          apiFetch<{ comments: Comment[] }>(`/api/tasks/${taskId}/comments`),
          apiFetch<{ subtasks: Subtask[] }>(`/api/tasks/${taskId}/subtasks`),
          apiFetch<{ dependencies: Dependency[] }>(
            `/api/tasks/${taskId}/dependencies`
          ),
          apiFetch<{ logs: TimeLog[] }>(`/api/tasks/${taskId}/time-logs`),
          apiFetch<{ attachments: Attachment[] }>(
            `/api/tasks/${taskId}/attachments`
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
  }, [taskId, open]);

  if (!task) return null;
  const currentTask = task;

  const isAssignee = currentTask.assignee_id === currentUser.id;
  // A signed-off task, or any task in a read-only project, can't be changed.
  const lockReason = currentTask.signed_off_at
    ? "This task is signed off and read-only."
    : projectReadOnlyReason;
  const readOnly = Boolean(lockReason);
  // Managers (admin/lead) manage everything; the assignee may drive execution
  // (status, checklist, logged hours) on their own task.
  const canEditExecution = !readOnly && (canManage || isAssignee);
  const canManageTask = !readOnly && canManage;
  const canDelete = canManageTask;
  const isTyped = specFieldsFor(currentTask.task_type).length > 0;
  const signOffMissing = signOffBlockers(currentTask, { signerIsManager: canManage });
  // Only an admin/lead can move a task out of Done (it's awaiting sign-off).
  const canChangeStatus = canEditExecution && (canManage || currentTask.status !== "done");
  const maySignOff =
    !readOnly &&
    currentTask.status === "done" &&
    canSignOff(currentUser, canManage, currentTask);
  const overdue = isOverdue(currentTask.due_date, currentTask.status);
  const subDone = subtasks.filter((s) => s.is_done).length;
  const subPct = subtasks.length
    ? Math.round((subDone / subtasks.length) * 100)
    : 0;
  // What the specification asks for but the checklist doesn't have yet.
  // A task created before its spec was seeded — or whose spec was written
  // afterwards — can be brought up to date in one click.
  const specPending = pendingChecklistItems(
    currentTask.task_type,
    currentTask,
    subtasks.map((s) => s.title)
  );
  const progress = taskProgress({
    status: currentTask.status,
    subtask_total: subtasks.length,
    subtask_done: subDone,
    estimated_hours: currentTask.estimated_hours,
    spent_hours: currentTask.spent_hours,
  });

  const totalMinutes = timeLogs.reduce((s, l) => s + l.minutes, 0);

  // Someone else changed the task (e.g. signed it off): show the current state.
  async function reloadIfChanged(e: unknown) {
    if (!isConflict(e)) return;
    try {
      const res = await apiFetch<{ task: Task }>(`/api/tasks/${currentTask.id}`);
      onChanged(res.task);
    } catch {
      // keep the error already shown
    }
  }

  async function downloadPdf() {
    setDownloading(true);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${currentTask.id}/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Could not create the PDF (${res.status})`);
      }
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
        `task-${currentTask.id}.pdf`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the PDF");
    } finally {
      setDownloading(false);
    }
  }

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
      void reloadIfChanged(e);
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
      void reloadIfChanged(e);
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
      void reloadIfChanged(e);
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
      void reloadIfChanged(e);
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
      void reloadIfChanged(e);
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
      void reloadIfChanged(e);
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
      void reloadIfChanged(e);
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
      void reloadIfChanged(e);
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
      void reloadIfChanged(e);
      toast(e instanceof Error ? e.message : "Could not remove file", "error");
    }
  }

  /**
   * Bring the checklist up to date with the specification. A new task is
   * seeded at creation; this is for the ones created before that, and for a
   * spec written or corrected afterwards. The server re-reads the stored
   * spec — this only asks it to.
   */
  async function addChecklistFromSpec() {
    setSeedingSpec(true);
    try {
      const res = await apiFetch<{ added: number; subtasks: Subtask[] }>(
        `/api/tasks/${currentTask.id}/subtasks/from-spec`,
        { method: "POST" }
      );
      setSubtasks(res.subtasks);
      syncCounts(res.subtasks);
      toast(
        res.added === 1
          ? "1 item added from the specification"
          : `${res.added} items added from the specification`
      );
    } catch (e) {
      void reloadIfChanged(e);
      toast(
        e instanceof Error ? e.message : "Could not read the specification",
        "error"
      );
    } finally {
      setSeedingSpec(false);
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
      void reloadIfChanged(e);
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
      void reloadIfChanged(e);
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
      void reloadIfChanged(e);
      toast(e instanceof Error ? e.message : "Could not delete subtask", "error");
    }
  }

  async function signOff() {
    if (signOffMissing.length) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ task: Task }>(
        `/api/tasks/${currentTask.id}/signoff`,
        { method: "POST", body: JSON.stringify({ note: signOffNote || null }) }
      );
      onChanged(res.task);
      setSignOffOpen(false);
      toast("Signed off — this task is now read-only");
    } catch (e) {
      void reloadIfChanged(e);
      setError(e instanceof Error ? e.message : "Could not sign off");
    } finally {
      setBusy(false);
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
        <WorkTypeBadge type={currentTask.task_type} />
        <TaskStatusBadge status={currentTask.status} />
        <TaskPriorityBadge priority={currentTask.priority} />
        {currentTask.signed_off_at && <ReadOnlyBadge />}
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
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={downloadPdf}
            disabled={downloading}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            {downloading ? "Preparing PDF…" : "Download PDF"}
          </button>
          {currentTask.due_date && (
            <a
              href={`/api/tasks/${currentTask.id}/ics`}
              download
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              📅 Add to calendar
            </a>
          )}
          {maySignOff && (
            <button
              onClick={() => setSignOffOpen((v) => !v)}
              aria-expanded={signOffOpen}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Sign off
            </button>
          )}
          {canManage && !projectReadOnlyReason && currentTask.status === "done" && (
            <button
              onClick={() => onAddFollowUp(currentTask)}
              className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50"
            >
              + Follow-up work
            </button>
          )}
          {canManageTask && (
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

      {lockReason && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span aria-hidden="true">🔒 </span>
          {lockReason}
          {currentTask.signed_off_at && (
            <>
              {" "}Signed off by <strong>{currentTask.signer_name ?? "—"}</strong> on{" "}
              {formatIst(String(currentTask.signed_off_at))}
              {currentTask.signoff_note ? ` — “${currentTask.signoff_note}”` : ""}
            </>
          )}
        </div>
      )}

      {signOffOpen && maySignOff && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-3">
          <h3 className="text-sm font-semibold text-slate-800">Sign off this task</h3>
          {signOffMissing.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-slate-600">
                These are mandatory before sign-off:
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-red-700">
                {signOffMissing.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-600">
                Confirm the work meets its{" "}
                {currentTask.task_type === "correction" ? "acceptance criteria" : "specification"}.
                Signing off makes this task and everything on it{" "}
                <strong>permanently read-only</strong>.
              </p>
              <label htmlFor="signoff-note" className="mt-2 block text-xs text-slate-600">
                Note (optional)
              </label>
              <textarea
                id="signoff-note"
                rows={2}
                maxLength={1000}
                value={signOffNote}
                onChange={(e) => setSignOffNote(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setSignOffOpen(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={signOff}
              disabled={busy || signOffMissing.length > 0}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Signing off…" : "Confirm sign-off"}
            </button>
          </div>
        </div>
      )}

      <ApprovalTrail task={currentTask} />

      {isTyped ? (
        <div className="mt-4 rounded-lg border border-slate-200 p-3">
          <SpecView item={currentTask} />
          {currentTask.description && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Notes
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">
                {currentTask.description}
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
          {currentTask.description || (
            <span className="text-slate-500">No description.</span>
          )}
        </p>
      )}

      {/* Progress */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
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
                <span className="ml-2 text-slate-600">
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
                  <label htmlFor="log-hours" className="block text-xs text-slate-600">
                    Hours
                  </label>
                  <input
                    id="log-hours"
                    type="number"
                    min="0"
                    value={logH}
                    onChange={(e) => setLogH(e.target.value)}
                    placeholder="0"
                    className="w-16 rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="log-minutes" className="block text-xs text-slate-600">
                    Minutes
                  </label>
                  <input
                    id="log-minutes"
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
                    <span className="text-slate-500">{l.user_name ?? "—"}</span>
                    {l.note && <span className="text-slate-600">· {l.note}</span>}
                    <span className="ml-auto text-slate-500">
                      {formatIst(l.logged_at)}
                    </span>
                    {!readOnly && (canManage || l.user_id === currentUser.id) && (
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
      {(deps.length > 0 || canManageTask) && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Blocked by</h3>
          {deps.length === 0 ? (
            <p className="text-xs text-slate-500">No dependencies.</p>
          ) : (
            <ul className="space-y-1">
              {deps.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      d.done ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className={d.done ? "text-slate-500 line-through" : "text-slate-700"}>
                    {d.title}
                  </span>
                  <span className="text-xs text-slate-500">
                    {TASK_STATUS_LABELS[d.status]}
                  </span>
                  {canManageTask && (
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
          {canManageTask && depCandidates.length > 0 && (
            <div className="mt-2 flex gap-2">
              <select
                aria-label="Add a blocking task"
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
          <dt className="text-xs text-slate-500">Assignee</dt>
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
          <dt className="text-xs text-slate-500">Due date</dt>
          <dd className={`font-medium ${overdue ? "text-red-600" : "text-slate-700"}`}>
            {currentTask.due_date ? formatDate(currentTask.due_date) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Created by</dt>
          <dd className="font-medium text-slate-700">
            {currentTask.creator_name ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">
            {canChangeStatus ? "Move to" : "Status"}
          </dt>
          <dd>
            {canChangeStatus ? (
              <select
                aria-label="Task status"
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">
            Checklist {subtasks.length > 0 && `(${subDone}/${subtasks.length})`}
          </h3>
          {canEditExecution && specPending.length > 0 && (
            <button
              type="button"
              onClick={addChecklistFromSpec}
              disabled={seedingSpec}
              title="Add what this task asks for — its expected behaviour and acceptance criteria, or its features and rules — as checklist items"
              className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {seedingSpec ? "Adding…" : `+ From specification (${specPending.length})`}
            </button>
          )}
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
                  s.is_done ? "text-slate-500 line-through" : "text-slate-700"
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
              title={!newSub.trim() ? "Type an item first" : undefined}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              Add item
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
                <span className="text-slate-500">📎</span>
                <a
                  href={`/api/attachments/${a.id}`}
                  className="truncate font-medium text-indigo-600 hover:underline"
                >
                  {a.filename}
                </a>
                <span className="text-xs text-slate-500">
                  {fmtBytes(Number(a.size_bytes))}
                  {a.uploader_name ? ` · ${a.uploader_name}` : ""}
                </span>
                {!readOnly && (canManage || a.uploaded_by === currentUser.id) && (
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
        {!readOnly && (
          <>
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
            <span className="ml-2 text-xs text-slate-500">Max 10 MB</span>
          </>
        )}
      </div>

      {/* Comments — set apart from the checklist above, which has its own
          input and button and was being mistaken for this one. */}
      <div className="mt-6 rounded-xl border-2 border-slate-200 bg-slate-50/60 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          💬 Comments ({comments.length})
        </h3>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-slate-500">No comments yet.</p>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => {
              const mine = c.user_id === currentUser.id;
              const canDel = !readOnly && (mine || canManage);
              return (
                <li key={c.id} className="flex gap-2">
                  <Avatar name={c.user_name ?? "?"} size="sm" />
                  <div className="flex-1 rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">
                        {c.user_name}
                      </span>
                      <span className="text-xs text-slate-500">
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
                          className="text-xs text-slate-500 hover:text-slate-600"
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
                          <div className="mt-1 flex gap-3 text-xs text-slate-500">
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

        {!readOnly && (
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
            // A permanently faded button reads as broken. Say why it is off.
            title={!body.trim() ? "Write something first" : undefined}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
          >
            {busy ? "Posting…" : "Post comment"}
          </button>
        </form>
        )}
      </div>
    </Modal>
  );
}

/** Requested → approved → owner → completed → signed off, with who and when. */
function ApprovalTrail({ task }: { task: Task }) {
  const steps: {
    label: string;
    who: string | null | undefined;
    when?: string | null;
    done: boolean;
  }[] = [
    {
      label: "Requested by",
      who: task.requester_name,
      when: task.requested_at,
      done: Boolean(task.requested_by),
    },
    {
      label: "Approved by",
      who: task.request_approver_name,
      when: task.request_approved_at,
      done: Boolean(task.request_approved_by),
    },
    { label: "Assigned owner", who: task.assignee_name, done: Boolean(task.assignee_id) },
    {
      label: "Completed",
      who: task.status === "done" ? task.done_by_name ?? "Done" : null,
      when: task.completed_at,
      done: task.status === "done",
    },
    {
      label: "Signed off by",
      who: task.signer_name,
      when: task.signed_off_at,
      done: Boolean(task.signed_off_at),
    },
  ];
  return (
    <section aria-label="Approval trail" className="mt-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Approval trail</h3>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {steps.map((s) => (
          <li
            key={s.label}
            className={`min-w-0 rounded-lg border px-2.5 py-2 ${
              s.done ? "border-emerald-200 bg-emerald-50/60" : "border-dashed border-slate-300"
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span
                aria-hidden="true"
                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  s.done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
                }`}
              >
                {s.done ? "✓" : ""}
              </span>
              {s.label}
            </div>
            <div
              className="mt-0.5 truncate text-sm font-medium text-slate-800"
              title={s.who ?? undefined}
            >
              {s.who || <span className="font-normal text-slate-500">Pending</span>}
            </div>
            {s.when && (
              <div className="text-[11px] text-slate-500">{formatIst(String(s.when))}</div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
