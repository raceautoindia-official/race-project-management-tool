"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ProjectStatusBadge } from "@/components/Badge";
import LabelChip from "@/components/LabelChip";
import Avatar from "@/components/Avatar";
import Calendar from "@/components/Calendar";
import ExportButton from "@/components/ExportButton";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatDate, isOverdue } from "@/lib/format";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type Label,
  type ProjectMember,
  type ProjectStatus,
  type Role,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/types";
import TaskCard from "./TaskCard";
import TaskFormModal from "./TaskFormModal";
import TaskDetailModal from "./TaskDetailModal";
import MembersModal from "./MembersModal";
import EditProjectModal from "./EditProjectModal";

interface PickUser {
  id: number;
  name: string;
  email: string;
}

interface ProjectInfo {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  owner_id: number | null;
  owner_name: string | null;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type ViewMode = "board" | "list" | "calendar";

export default function ProjectBoard({
  project: initialProject,
  initialTasks,
  initialMembers,
  initialLabels,
  allUsers,
  currentUser,
  canManage,
}: {
  project: ProjectInfo;
  initialTasks: Task[];
  initialMembers: ProjectMember[];
  initialLabels: Label[];
  allUsers: PickUser[];
  currentUser: { id: number; role: Role };
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [project, setProject] = useState(initialProject);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [members, setMembers] = useState<ProjectMember[]>(initialMembers);
  const [labels, setLabels] = useState<Label[]>(initialLabels);
  const [view, setView] = useState<ViewMode>("board");

  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<number | null>(null);

  const [fStatus, setFStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [sortKey, setSortKey] = useState<"due_date" | "priority" | "title" | "status">("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const isAdmin = currentUser.role === "admin";

  function upsertTask(task: Task) {
    setTasks((ts) =>
      ts.some((t) => t.id === task.id)
        ? ts.map((t) => (t.id === task.id ? task : t))
        : [task, ...ts]
    );
    setDetailTask((dt) => (dt && dt.id === task.id ? task : dt));
  }

  function removeTask(id: number) {
    setTasks((ts) => ts.filter((t) => t.id !== id));
  }

  async function moveTask(id: number, status: TaskStatus) {
    const current = tasks.find((t) => t.id === id);
    if (!current || current.status === status) return;
    const snapshot = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      const res = await apiFetch<{ task: Task }>(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      upsertTask(res.task);
    } catch (e) {
      setTasks(snapshot);
      toast(e instanceof Error ? e.message : "Could not move task", "error");
    }
  }

  function openCreate() {
    setEditingTask(null);
    setFormOpen(true);
  }
  function openEdit(task: Task) {
    setDetailOpen(false);
    setEditingTask(task);
    setFormOpen(true);
  }
  function openDetail(task: Task) {
    setDetailTask(task);
    setDetailOpen(true);
  }

  const visibleList = useMemo(() => {
    let list = tasks.slice();
    if (fStatus) list = list.filter((t) => t.status === fStatus);
    if (fPriority) list = list.filter((t) => t.priority === fPriority);
    if (fAssignee) list = list.filter((t) => String(t.assignee_id) === fAssignee);
    if (fLabel)
      list = list.filter((t) => (t.labels ?? []).some((l) => String(l.id) === fLabel));
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "priority") cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      else if (sortKey === "due_date") cmp = (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
      else if (sortKey === "title") cmp = a.title.localeCompare(b.title);
      else cmp = a.status.localeCompare(b.status);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [tasks, fStatus, fPriority, fAssignee, fLabel, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div>
      <div className="mb-2 text-sm text-slate-400">
        <Link href="/projects" className="hover:text-indigo-600">
          ← Projects
        </Link>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
              <ProjectStatusBadge status={project.status} />
            </div>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              {project.description || "No description"}
            </p>
            {project.owner_name && (
              <p className="mt-1 text-xs text-slate-400">Owner: {project.owner_name}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={openCreate}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              + New task
            </button>
            <ExportButton href={`/api/projects/${project.id}/tasks/export`} />
            {canManage && (
              <>
                <button
                  onClick={() => setMembersOpen(true)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Members ({members.length})
                </button>
                <button
                  onClick={() => setEditOpen(true)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Edit project
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {done}/{total} tasks done ({pct}%)
          </div>
        </div>
      </div>

      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {(["board", "list", "calendar"] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1.5 font-medium capitalize ${
              view === v ? "bg-indigo-600 text-white" : "text-slate-600"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "board" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {TASK_STATUSES.map((status) => {
            const colTasks = tasks.filter((t) => t.status === status);
            return (
              <div
                key={status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggedId != null) moveTask(draggedId, status);
                  setDraggedId(null);
                }}
                className="flex flex-col rounded-xl bg-slate-100/70 p-3"
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-slate-700">
                    {TASK_STATUS_LABELS[status]}
                  </span>
                  <span className="rounded-full bg-white px-2 text-xs font-medium text-slate-500">
                    {colTasks.length}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {colTasks.map((t) => (
                    <TaskCard key={t.id} task={t} onOpen={openDetail} onDragStart={setDraggedId} />
                  ))}
                  {colTasks.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-slate-400">Drop tasks here</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "list" && (
        <ListView
          tasks={visibleList}
          members={members}
          labels={labels}
          fStatus={fStatus}
          fPriority={fPriority}
          fAssignee={fAssignee}
          fLabel={fLabel}
          setFStatus={setFStatus}
          setFPriority={setFPriority}
          setFAssignee={setFAssignee}
          setFLabel={setFLabel}
          onOpen={openDetail}
          toggleSort={toggleSort}
          sortKey={sortKey}
          sortDir={sortDir}
        />
      )}

      {view === "calendar" && <Calendar tasks={tasks} onSelect={openDetail} />}

      <TaskFormModal
        key={`taskform-${formOpen ? editingTask?.id ?? "new" : "closed"}`}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        projectId={project.id}
        members={members}
        labels={labels}
        task={editingTask}
        onSaved={upsertTask}
        onLabelCreated={(l) => setLabels((prev) => [...prev, l])}
      />
      <TaskDetailModal
        key={`taskdetail-${detailTask?.id ?? "none"}`}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        task={detailTask}
        currentUser={currentUser}
        canManage={canManage}
        onEdit={openEdit}
        onChanged={upsertTask}
        onDeleted={removeTask}
      />
      {canManage && (
        <>
          <MembersModal
            open={membersOpen}
            onClose={() => setMembersOpen(false)}
            projectId={project.id}
            ownerId={project.owner_id}
            members={members}
            allUsers={allUsers}
            onChanged={setMembers}
          />
          <EditProjectModal
            open={editOpen}
            onClose={() => setEditOpen(false)}
            project={project}
            canDelete={isAdmin}
            onSaved={(p) => setProject((prev) => ({ ...prev, ...p }))}
          />
        </>
      )}
    </div>
  );
}

function ListView({
  tasks,
  members,
  labels,
  fStatus,
  fPriority,
  fAssignee,
  fLabel,
  setFStatus,
  setFPriority,
  setFAssignee,
  setFLabel,
  onOpen,
  toggleSort,
  sortKey,
  sortDir,
}: {
  tasks: Task[];
  members: ProjectMember[];
  labels: Label[];
  fStatus: string;
  fPriority: string;
  fAssignee: string;
  fLabel: string;
  setFStatus: (v: string) => void;
  setFPriority: (v: string) => void;
  setFAssignee: (v: string) => void;
  setFLabel: (v: string) => void;
  onOpen: (t: Task) => void;
  toggleSort: (k: "due_date" | "priority" | "title" | "status") => void;
  sortKey: string;
  sortDir: "asc" | "desc";
}) {
  const selectClass =
    "rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none";
  const arrow = (k: string) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectClass}>
          <option value="">All statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className={selectClass}>
          <option value="">All priorities</option>
          {(["low", "medium", "high", "urgent"] as TaskPriority[]).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className={selectClass}>
          <option value="">All assignees</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </select>
        {labels.length > 0 && (
          <select value={fLabel} onChange={(e) => setFLabel(e.target.value)} className={selectClass}>
            <option value="">All labels</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="cursor-pointer px-4 py-2" onClick={() => toggleSort("title")}>
              Title{arrow("title")}
            </th>
            <th className="cursor-pointer px-4 py-2" onClick={() => toggleSort("status")}>
              Status{arrow("status")}
            </th>
            <th className="cursor-pointer px-4 py-2" onClick={() => toggleSort("priority")}>
              Priority{arrow("priority")}
            </th>
            <th className="px-4 py-2">Assignee</th>
            <th className="cursor-pointer px-4 py-2" onClick={() => toggleSort("due_date")}>
              Due{arrow("due_date")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {tasks.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                No tasks match these filters.
              </td>
            </tr>
          ) : (
            tasks.map((t) => (
              <tr key={t.id} onClick={() => onOpen(t)} className="cursor-pointer hover:bg-slate-50">
                <td className="px-4 py-2">
                  <div className="font-medium text-slate-800">{t.title}</div>
                  {t.labels && t.labels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.labels.map((l) => (
                        <LabelChip key={l.id} name={l.name} color={l.color} />
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600">{TASK_STATUS_LABELS[t.status]}</td>
                <td className="px-4 py-2 capitalize text-slate-600">{t.priority}</td>
                <td className="px-4 py-2 text-slate-600">
                  {t.assignee_name ? (
                    <span className="flex items-center gap-1.5">
                      <Avatar name={t.assignee_name} size="sm" />
                      {t.assignee_name}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td
                  className={`px-4 py-2 ${
                    isOverdue(t.due_date, t.status) ? "font-medium text-red-600" : "text-slate-600"
                  }`}
                >
                  {t.due_date ? formatDate(t.due_date) : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
