"use client";

import { useRef, useState } from "react";
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
  TaskRequest,
  TaskStatus,
} from "@/lib/types";
import MoreFields from "@/components/MoreFields";
import TaskTemplatePicker, {
  templateData,
  type TaskTemplate,
} from "./TaskTemplatePicker";
import { pickSpec, specPayload, WorkSpecFields } from "./WorkSpec";
import PointsInput, { pointsOf } from "./PointsInput";
import {
  CHECKLIST_SOURCES,
  checklistFor,
  SPEC_KEYS,
  SPEC_LABELS,
  specBodyKey,
  type SpecKey,
  type SpecType,
} from "@/lib/workflow";
import { FilesField, filesOk, uploadFiles } from "@/components/work/AttachFiles";
import {
  lastMode,
  rememberMode,
  sendNewWork,
  type FormMode,
  type NewWorkDraft,
} from "./new-work";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

const MODES: { mode: FormMode; label: string; hint: string }[] = [
  { mode: "quick", label: "Quick", hint: "A title, dates and a list of steps" },
  { mode: "detailed", label: "Detailed", hint: "A correction or new feature, with its specification" },
];

/** Where a quick task's steps go when it becomes a correction or a feature. */
const STEPS_FIELD: Record<SpecType, SpecKey> = {
  correction: "acceptance_criteria",
  feature: "features",
};

/** Lines of `a` followed by the lines of `b` it doesn't already have. */
function mergePoints(a: string, b: string): string {
  const out = pointsOf(a);
  const seen = new Set(out.map((p) => p.toLowerCase()));
  for (const p of pointsOf(b)) {
    if (!seen.has(p.toLowerCase())) {
      seen.add(p.toLowerCase());
      out.push(p);
    }
  }
  return out.join("\n");
}

/**
 * The one task form, used to create, edit and follow up on tasks.
 *
 * - Quick: a title, owner, dates and steps (each step becomes a subtask).
 * - Detailed: a correction or new feature with its specification, whose
 *   points become the subtasks.
 *
 * Who is asking decides where it goes: someone who manages the project
 * creates the task; anyone else sends it to a lead for approval.
 */
export default function TaskFormModal({
  open,
  onClose,
  projectId,
  members,
  labels,
  task,
  parentTask,
  currentUserId,
  myDepartment,
  canManage = true,
  draft,
  onSaved,
  onRequested,
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
  /** The signed-in person's department, so their templates come first. */
  myDepartment?: string | null;
  /** False for a project member: what they write becomes a request. */
  canManage?: boolean;
  /** What was already typed in the inline "+ Add task" row. */
  draft?: NewWorkDraft | null;
  onSaved: (task: Task) => void;
  onRequested?: (request: TaskRequest) => void;
  onLabelCreated: (label: Label) => void;
}) {
  const { toast } = useToast();
  const isEdit = Boolean(task);
  const asRequest = !isEdit && !canManage;
  // A correction or feature can't go back to being a plain task.
  const wasTyped = Boolean(task && task.task_type !== "general");

  // Initial values come straight from `task`. The parent gives this modal a
  // `key` tied to the task being opened, so it remounts (and re-initializes)
  // each time it opens — no state-syncing effect needed.
  const [mode, setMode] = useState<FormMode>(() =>
    task ? (wasTyped ? "detailed" : "quick") : lastMode()
  );
  const [type, setType] = useState<SpecType>(
    task?.task_type === "correction" || task?.task_type === "feature" ? task.task_type : "correction"
  );
  const [spec, setSpec] = useState<SpecColumns>(pickSpec(task));
  const [steps, setSteps] = useState("");
  const [title, setTitle] = useState(task?.title ?? draft?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
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
    (task?.priority as TaskPriority) ?? (draft?.priority as TaskPriority) ?? "medium"
  );
  const [assigneeId, setAssigneeId] = useState<string>(() => {
    const id = task ? task.assignee_id : draft?.assigneeId;
    return id ? String(id) : "";
  });
  const [estimatedHours, setEstimatedHours] = useState<string>(
    task?.estimated_hours != null ? String(task.estimated_hours) : ""
  );
  const [startDate, setStartDate] = useState<string>(task?.start_date ?? draft?.startDate ?? "");
  const [dueDate, setDueDate] = useState<string>(task?.due_date ?? draft?.dueDate ?? "");
  const [labelIds, setLabelIds] = useState<number[]>(
    task?.labels?.map((l) => l.id) ?? []
  );
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState<string>("indigo");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  // The point lists seed themselves once; switching mode or applying a
  // template rewrites what they hold, so they are remounted around it.
  const [seed, setSeed] = useState(0);

  const detailed = mode === "detailed";
  const badDates = Boolean(startDate && dueDate && dueDate < startDate);
  // What the new work starts with — the same rule the server uses.
  const preview = isEdit ? [] : checklistFor(detailed ? type : "general", spec, steps);

  function switchMode(next: FormMode) {
    if (next === mode) return;
    if (next === "detailed") {
      // The steps become the checklist field of the chosen type.
      if (pointsOf(steps).length) {
        const key = STEPS_FIELD[type];
        setSpec((s) => ({ ...s, [key]: mergePoints(s[key] ?? "", steps) }));
      }
    } else {
      // And back: the checklist points become the steps. The other fields
      // stay, in case they switch back again.
      const points = CHECKLIST_SOURCES[type].map((k) => spec[k] ?? "").join("\n");
      setSteps((s) => mergePoints(s, points));
    }
    setMode(next);
    setSeed((n) => n + 1);
  }

  function applyTemplate(t: TaskTemplate) {
    const d = templateData(t);
    const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
    setTitle(str("title"));
    if (d.taskType === "correction" || d.taskType === "feature") {
      setType(d.taskType);
      setMode("detailed");
    } else {
      setMode("quick");
    }
    const next: SpecColumns = {};
    for (const key of SPEC_KEYS) next[key] = str(specBodyKey(key));
    setSpec(next);
    setSteps(str("steps"));
    setDescription(str("description"));
    if (typeof d.priority === "string") setPriority(d.priority as TaskPriority);
    setEstimatedHours(d.estimatedHours == null ? "" : String(d.estimatedHours));
    // Labels travel by name: the same label in another project is a
    // different row, and one this project has never heard of is dropped
    // rather than invented.
    const names = Array.isArray(d.labelNames) ? (d.labelNames as string[]) : [];
    setLabelIds(labels.filter((l) => names.includes(l.name)).map((l) => l.id));
    setSeed((n) => n + 1);
    toast(`Filled in from "${t.name}" — change anything before saving it`);
  }

  // Nothing is hidden from someone who already filled it in: the section
  // opens with the form when it holds something.
  const detailsOpen = requestedById === "" || status !== "todo" || labelIds.length > 0;
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

  function fail(message: string) {
    setError(message);
    // The message sits by the buttons; make sure it is on screen.
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: "nearest" }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (badDates) return fail("The due date can't be before the start date.");
    if (!filesOk(files)) return fail("Remove the files over 10 MB first.");
    setError("");
    setBusy(true);
    const payload = {
      title,
      description,
      ...(detailed
        ? { taskType: type, ...specPayload(type, spec) }
        : isEdit
          ? {}
          : { steps: steps || null }),
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
      if (isEdit) {
        const res = await apiFetch<{ task: Task }>(`/api/tasks/${task!.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        onSaved(res.task);
        toast("Task updated");
      } else {
        const sent = await sendNewWork(projectId, asRequest, payload);
        rememberMode(mode);
        if (sent.kind === "task") {
          const failed = files.length
            ? await uploadFiles(`/api/tasks/${sent.task.id}/attachments`, files)
            : [];
          onSaved(sent.task);
          if (failed.length) toast(`Task created, but these files didn't upload: ${failed.join(", ")}`, "error");
          else toast("Task created");
        } else {
          onRequested?.(sent.request);
          toast("Sent for approval — a project lead will review it");
        }
      }
      onClose();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Could not save task");
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
        {parentTask && !isEdit && (
          <div className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-700">
            Follow-up to <strong>{parentTask.title}</strong> — this will be
            flagged as additional work.
          </div>
        )}
        {asRequest && (
          <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 ring-1 ring-inset ring-indigo-200">
            A project lead reviews this, chooses who does it and approves it before
            work starts.
          </div>
        )}

        {!isEdit && !parentTask && (
          <TaskTemplatePicker myDepartment={myDepartment} onApply={applyTemplate} />
        )}

        {!wasTyped && (
          <fieldset>
            <legend className="mb-1 block text-sm font-medium text-slate-700">
              How much detail?
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {MODES.map((m) => {
                const selected = mode === m.mode;
                return (
                  <label
                    key={m.mode}
                    className={`cursor-pointer rounded-lg border px-3 py-2 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400 ${
                      selected
                        ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="task-form-mode"
                      value={m.mode}
                      checked={selected}
                      onChange={() => switchMode(m.mode)}
                      className="sr-only"
                    />
                    <span className="block text-sm font-semibold text-slate-800">{m.label}</span>
                    <span className="block text-xs text-slate-600">{m.hint}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* What every task has, whatever else it has. */}
        <div>
          <label htmlFor="task-title" className="mb-1 block text-sm font-medium text-slate-700">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            id="task-title"
            required
            maxLength={200}
            autoFocus={!isEdit}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={detailed ? "Dealer search ignores dealer codes" : "Order new bearings"}
            className={inputClass}
          />
        </div>

        <div className={`grid grid-cols-1 gap-3 ${asRequest ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
          {!asRequest && (
            <div>
              <label htmlFor="task-assignee" className="mb-1 block text-sm font-medium text-slate-700">
                Assigned owner {detailed && <span className="text-red-500">*</span>}
              </label>
              <select
                id="task-assignee"
                required={detailed}
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className={inputClass}
              >
                <option value="">{detailed ? "Choose an owner…" : "Unassigned"}</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
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
            <label htmlFor="task-estimate" className="mb-1 block text-sm font-medium text-slate-700">
              Estimated hours
            </label>
            <input
              id="task-estimate"
              type="number"
              min="0"
              step="0.5"
              inputMode="decimal"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
              placeholder="e.g. 8"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="task-start" className="mb-1 block text-sm font-medium text-slate-700">
              Start date
            </label>
            <input
              id="task-start"
              type="date"
              value={startDate}
              max={dueDate || undefined}
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
              min={startDate || undefined}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {detailed ? (
          <WorkSpecFields
            key={`spec-${seed}`}
            type={type}
            onTypeChange={setType}
            spec={spec}
            onSpecChange={setSpec}
          />
        ) : (
          !isEdit && (
            <PointsInput
              key={`steps-${seed}`}
              id="task-steps"
              label="Steps"
              required={false}
              hint="One thing to do"
              help={
                <>
                  Add one step per box — <strong>each becomes a subtask</strong> for
                  whoever owns the task. Leave it empty to split the task up later.
                </>
              }
              addLabel="+ Add step"
              value={steps}
              onChange={setSteps}
            />
          )
        )}

        <div>
          <label htmlFor="task-description" className="mb-1 block text-sm font-medium text-slate-700">
            Description <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="task-description"
            rows={2}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anything the person doing it should know"
            className={inputClass}
          />
        </div>

        {/* What the work will start with, before it is saved. */}
        {preview.length > 0 && (
          <section
            aria-label="Subtasks preview"
            className="rounded-xl bg-emerald-50/70 px-4 py-3 ring-1 ring-inset ring-emerald-200"
          >
            <p className="text-sm font-medium text-emerald-900">
              {asRequest ? "Once approved, this starts with " : "This starts with "}
              <strong>
                {preview.length} subtask{preview.length === 1 ? "" : "s"}
              </strong>
              {asRequest ? ", for the owner the lead picks." : ", for the task owner."}
            </p>
            {(detailed ? CHECKLIST_SOURCES[type] : [null]).map((source) => {
              const items = preview.filter((p) => p.source === source);
              if (!items.length) return null;
              return (
                <div key={source ?? "steps"} className="mt-2">
                  {source && (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800/80">
                      {SPEC_LABELS[source]}
                    </p>
                  )}
                  <ul className="mt-0.5 space-y-0.5 text-sm text-emerald-950">
                    {items.map((p) => (
                      <li key={p.title} className="flex gap-1.5">
                        <span aria-hidden className="text-emerald-600">☐</span>
                        <span>{p.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        )}

        {!isEdit && !asRequest && (
          <div>
            <span className="block text-sm font-medium text-slate-700">Files</span>
            <FilesField
              files={files}
              onChange={setFiles}
              hint="Optional — drawings, documents or screenshots. Up to 10 MB each."
            />
          </div>
        )}

        {!asRequest && (
          <MoreFields
            key={`details-${seed}`}
            label="More details"
            hint="Who asked, status and labels"
            defaultOpen={detailsOpen}
          >
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
            </div>

            <div className="mt-3">
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
          </MoreFields>
        )}

        {(error || badDates) && (
          <div ref={errorRef} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error || "The due date can't be before the start date."}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || badDates}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : asRequest
                  ? "Send for approval"
                  : "Create task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
