"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import TaskDetailModal from "@/components/project/TaskDetailModal";
import TaskFormModal from "@/components/project/TaskFormModal";
import { TaskStatusBadge } from "@/components/Badge";
import type { Label, ProjectMember, Role, Task, TaskStatus } from "@/lib/types";
import { DateRange, PersonLine, ProgressLegend, WorkProgress, weightLabel } from "./kit";

/**
 * The task page: who owns it and who reviews it, its dates, how much it
 * counts toward the project and how far along it is (approved work only) —
 * then the full task body (TaskDetailModal in its page variant), with the
 * subtasks first.
 */
export default function TaskPageView({
  initialTask,
  project,
  projectReadOnlyReason,
  weight,
  members,
  labels: initialLabels,
  projectTasks,
  currentUser,
  canManage,
  openSubtaskId,
  focus,
}: {
  initialTask: Task;
  project: {
    id: number;
    name: string;
    owner_id: number | null;
    owner_name: string | null;
    owner_designation: string | null;
    owner_department: string | null;
  };
  projectReadOnlyReason: string | null;
  weight: number;
  members: ProjectMember[];
  labels: Label[];
  projectTasks: { id: number; title: string; status: TaskStatus }[];
  currentUser: { id: number; role: Role; name: string; department?: string | null };
  canManage: boolean;
  openSubtaskId: number | null;
  focus: "blockers" | null;
}) {
  const router = useRouter();
  const [task, setTask] = useState(initialTask);
  const [labels, setLabels] = useState(initialLabels);
  const [form, setForm] = useState<{ edit: Task | null; parent: Task | null } | null>(null);
  const owner = members.find((m) => m.user_id === task.assignee_id);
  const hasSubtasks = Number(task.subtask_total ?? 0) > 0;
  const approved = task.status === "done" ? 100 : Number(task.progress_approved ?? 0);
  const pending = Number(task.progress_pending ?? 0);

  // What happens next, in plain words.
  const next =
    task.signed_off_at
      ? "Signed off — this task is finished and read-only."
      : task.status === "done"
        ? "Approved. It now counts toward the project; its requester can sign it off."
        : task.status === "review"
          ? `Waiting for ${project.owner_name ?? "the project owner"} (or a lead) to approve it.`
          : hasSubtasks
            ? "It goes for review automatically when every subtask is approved."
            : `${task.assignee_name ?? "Its owner"} sends it for review when it's finished.`;

  return (
    <div>
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:text-indigo-600 hover:underline">Projects</Link>
        <span aria-hidden>›</span>
        <Link href={`/projects/${project.id}`} className="hover:text-indigo-600 hover:underline">{project.name}</Link>
        <span aria-hidden>›</span>
        <span className="truncate text-slate-700">{task.title}</span>
      </nav>

      <section className="mb-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Task</p>
            <h1 className="text-2xl font-semibold text-slate-900">{task.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <TaskStatusBadge status={task.status} />
              <span className="text-xs text-slate-500" title={`This task's share of ${project.name}'s progress`}>
                Counts for <strong className="figure text-slate-700">{weightLabel(weight)}</strong> of the project
              </span>
            </div>
          </div>
          <Link href={`/projects/${project.id}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            ← Back to project
          </Link>
        </div>

        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-slate-500">Task owner</dt>
            <dd className="mt-1">
              <PersonLine name={task.assignee_name} designation={owner?.designation} department={owner?.department} size="md" empty="No owner" />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Approved by</dt>
            <dd className="mt-1">
              <PersonLine name={project.owner_name} designation={project.owner_designation} department={project.owner_department} size="md" empty="No owner" />
              <span className="mt-0.5 block text-xs text-slate-400">Project owner (or a lead)</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Dates</dt>
            <dd className="mt-1">
              <DateRange start={task.start_date} due={task.due_date} finished={task.status === "done"} notStarted={task.status === "todo"} />
            </dd>
          </div>
        </dl>

        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <p className="mb-2">
            <span className="figure text-2xl font-semibold text-slate-900">{Math.round(approved)}%</span>
            <span className="ml-2 text-sm text-slate-500">complete (approved)</span>
            {pending > 0.5 && <span className="ml-2 text-sm text-amber-700">+ {Math.round(pending)}% waiting for review</span>}
          </p>
          <WorkProgress approved={approved} pending={pending} size="lg" label="Task progress" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <ProgressLegend />
            <span className="text-xs text-slate-600">{next}</span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <TaskDetailModal
          variant="page"
          open
          onClose={() => router.push(`/projects/${project.id}`)}
          task={task}
          focus={focus}
          openSubtaskId={openSubtaskId}
          currentUser={currentUser}
          canManage={canManage}
          projectReadOnlyReason={projectReadOnlyReason}
          members={members}
          projectTasks={projectTasks}
          onEdit={(t) => setForm({ edit: t, parent: null })}
          onAddFollowUp={(t) => setForm({ edit: null, parent: t })}
          onChanged={setTask}
          onDeleted={() => router.push(`/projects/${project.id}`)}
        />
      </section>

      <TaskFormModal
        key={form ? `form-${form.edit?.id ?? `fu-${form.parent?.id}`}` : "closed"}
        open={!!form}
        onClose={() => setForm(null)}
        projectId={project.id}
        members={members}
        labels={labels}
        task={form?.edit ?? null}
        parentTask={form?.parent ?? null}
        currentUserId={currentUser.id}
        myDepartment={currentUser.department}
        onSaved={(saved) => {
          setForm(null);
          // A follow-up is a new task: go to it. An edit stays here.
          if (saved.id !== task.id) router.push(`/projects/${project.id}/tasks/${saved.id}`);
          else setTask(saved);
        }}
        onLabelCreated={(l) => setLabels((prev) => [...prev, l])}
      />
    </div>
  );
}
