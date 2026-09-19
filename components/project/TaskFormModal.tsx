"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { LABEL_COLORS, labelChipClass, labelSwatchClass } from "@/lib/colors";
import type {
  Label,
  ProjectMember,
  SpecColumns,
  Task,
  TaskPriority,
  TaskStatus,
  WorkType,
} from "@/lib/types";
import { pickSpec, specPayload, WorkSpecFields } from "./WorkSpec";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export default function TaskFormModal({
  open,
  onClose,
  projectId,
  members,
  labels,
  task,
  parentTask,
  currentUserId,
  onSaved,
  onLabelCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  members: ProjectMember[];
  labels: Label[];
  task?: Task | null;
  parentTask?: Task | null;
  currentUserId: number;
  onSaved: (task: Task) => void;
  onLabelCreated: (label: Label) => void;
}) {
  const { toast } = useToast();
  const isEdit = Boolean(task);

  // Initial values come straight from `task`. The parent gives this modal a
  // `key` tied to the task being opened, so it remounts (and re-initializes)
  // each time it opens — no state-syncing effect needed.
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [type, setType] = useState<WorkType>(
    task?.task_type ?? (isEdit ? "general" : "correction")
  );
  const [spec, setSpec] = useState<SpecColumns>(pickSpec(task));
  // Editing keeps the recorded requester (blank if unknown, so it must be
  // chosen); a follow-up defaults to the parent's requester; new work to you.
  const [requestedById, setRequestedById] = useState<string>(() => {
    if (task) return task.requested_by ? String(task.requested_by) : "";
    return String(parentTask?.requested_by ?? currentUserId);
  });
  const [status, setStatus] = useState<TaskStatus>(
    (task?.status as TaskStatus) ?? "todo"
  );
  const [priority, setPriority] = useState<TaskPriority>(
    (task?.priority as TaskPriority) ?? "medium"
  );
  const [assigneeId, setAssigneeId] = useState<string>(
    task?.assignee_id ? String(task.assignee_id) : ""
  );
  const [estimatedHours, setEstimatedHours] = useState<string>(
    task?.estimated_hours != null ? String(task.estimated_hours) : ""
  );
  const [startDate, setStartDate] = useState<string>(task?.start_date ?? "");
  const [dueDate, setDueDate] = useState<string>(task?.due_date ?? "");
  const [labelIds, setLabelIds] = useState<number[]>(
    task?.labels?.map((l) => l.id) ?? []
  );
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState<string>("indigo");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const typed = type !== "general";
  // Legacy notes stay editable after a task is converted to a typed task.
  const showNotes = typed && Boolean(task?.description);
  // The requester may be someone outside the member list (e.g. an admin).
  const requesterOptions =
    requestedById === "" || members.some((m) => String(m.user_id) === requestedById)
      ? members
      : [
          ...members,
          {
            user_id: Number(requestedById),
            name:
              task?.requester_name ??
              (Number(requestedById) === currentUserId
                ? "You"
                : parentTask?.requester_name ?? "Requester"),
          } as ProjectMember,
        ];

  function toggleLabel(id: number) {
    setLabelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function createLabel() {
    if (!newLabel.trim()) return;
    try {
      const res = await apiFetch<{ label: Label }>(
        `/api/projects/${projectId}/labels`,
        {
          method: "POST",
          body: JSON.stringify({ name: newLabel.trim(), color: newColor }),
        }
      );
      onLabelCreated(res.label);
      setLabelIds((prev) => [...prev, res.label.id]);
      setNewLabel("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create label", "error");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const payload = {
      title,
      // Typed tasks are described by their spec; description stays for legacy ones.
      ...(typed
        ? { taskType: type, ...specPayload(type, spec), ...(showNotes ? { description } : {}) }
        : { description }),
      requestedById: requestedById === "" ? null : Number(requestedById),
      status,
      priority,
      estimatedHours: estimatedHours === "" ? null : Number(estimatedHours),
      assigneeId: assigneeId === "" ? null : Number(assigneeId),
      dueDate: dueDate === "" ? null : dueDate,
      startDate: startDate === "" ? null : startDate,
      labelIds,
      ...(parentTask && !isEdit ? { parentTaskId: parentTask.id } : {}),
    };
    try {
      const res = isEdit
        ? await apiFetch<{ task: Task }>(`/api/tasks/${task!.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await apiFetch<{ task: Task }>(`/api/projects/${projectId}/tasks`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
      onSaved(res.task);
      toast(isEdit ? "Task updated" : "Task created");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit task" : parentTask ? "Add follow-up work" : "New task"}
      widthClass="max-w-2xl"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {parentTask && !isEdit && (
          <div className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-700">
            Follow-up to <strong>{parentTask.title}</strong> — this will be
            flagged as additional work.
          </div>
        )}

        <WorkSpecFields
          type={type}
          onTypeChange={setType}
          spec={spec}
          onSpecChange={setSpec}
        >
          <div>
            <label htmlFor="task-title" className="mb-1 block text-sm font-medium text-slate-700">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="task-title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </div>
        </WorkSpecFields>
        {(!typed || showNotes) && (
          <div>
            <label htmlFor="task-description" className="mb-1 block text-sm font-medium text-slate-700">
              {typed ? (
                <>
                  Notes <span className="font-normal text-slate-500">(optional)</span>
                </>
              ) : (
                "Description"
              )}
            </label>
            <textarea
              id="task-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="task-requested-by" className="mb-1 block text-sm font-medium text-slate-700">
              Requested by <span className="text-red-500">*</span>
            </label>
            <select
              id="task-requested-by"
              required
              // Part of the approval trail: fixed once the task is Done.
              disabled={Boolean(task?.status === "done" && task.requested_by)}
              value={requestedById}
              onChange={(e) => setRequestedById(e.target.value)}
              className={inputClass}
            >
              {requestedById === "" && <option value="">Choose who requested it…</option>}
              {requesterOptions.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                  {m.user_id === currentUserId && m.name !== "You" ? " (you)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="task-assignee" className="mb-1 block text-sm font-medium text-slate-700">
              Assigned owner {typed && <span className="text-red-500">*</span>}
            </label>
            <select
              id="task-assignee"
              required={typed}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className={inputClass}
            >
              <option value="">{typed ? "Choose an owner…" : "Unassigned"}</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="task-status" className="mb-1 block text-sm font-medium text-slate-700">
              Status
            </label>
            <select
              id="task-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className={inputClass}
            >
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="review">Review</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div>
            <label htmlFor="task-priority" className="mb-1 block text-sm font-medium text-slate-700">
              Priority
            </label>
            <select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className={inputClass}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label htmlFor="task-start" className="mb-1 block text-sm font-medium text-slate-700">
              Start date
            </label>
            <input
              id="task-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="task-due" className="mb-1 block text-sm font-medium text-slate-700">
              Due date
            </label>
            <input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="task-estimate" className="mb-1 block text-sm font-medium text-slate-700">
              Estimated hours
            </label>
            <input
              id="task-estimate"
              type="number"
              min="0"
              step="0.5"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
              placeholder="e.g. 8"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Labels</span>
          {labels.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {labels.map((l) => {
                const selected = labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleLabel(l.id)}
                    className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition ${labelChipClass(l.color)} ${
                      selected ? "" : "opacity-40 hover:opacity-80"
                    }`}
                  >
                    {selected ? "✓ " : ""}
                    {l.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="New label…"
              aria-label="New label name"
              className="min-w-32 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <div className="flex gap-1">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`h-6 w-6 rounded-full ${labelSwatchClass(c)} ${
                    newColor === c ? "ring-2 ring-slate-400 ring-offset-1" : ""
                  }`}
                  aria-label={c}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={createLabel}
              disabled={!newLabel.trim()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>

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
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
