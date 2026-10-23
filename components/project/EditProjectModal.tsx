"use client";

import { useEffect, useState } from "react";
import { DepartmentSelect } from "@/components/DepartmentField";
import ProjectDatesFields, { dateOrderError } from "@/components/ProjectDatesFields";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import type { Project, ProjectStatus } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export default function EditProjectModal({
  open,
  onClose,
  project,
  canDelete,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  project: Pick<Project, "id" | "name" | "description" | "status"> & {
    department?: string | null;
    /** Left out (undefined) when the caller doesn't have them; they are then fetched. */
    start_date?: string | null;
    due_date?: string | null;
  };
  canDelete: boolean;
  onSaved: (p: {
    name: string;
    description: string | null;
    department: string | null;
    status: ProjectStatus;
    start_date: string | null;
    due_date: string | null;
  }) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [department, setDepartment] = useState(project.department ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const knownDates = project.start_date !== undefined || project.due_date !== undefined;
  const [startDate, setStartDate] = useState((project.start_date ?? "").slice(0, 10));
  const [dueDate, setDueDate] = useState((project.due_date ?? "").slice(0, 10));
  // Dates are only sent once we know what they were, so a save can't wipe them.
  const [datesReady, setDatesReady] = useState(knownDates);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || datesReady) return;
    let live = true;
    apiFetch<{ project: { start_date: string | null; due_date: string | null } }>(`/api/projects/${project.id}`)
      .then((r) => {
        if (!live) return;
        setStartDate((r.project.start_date ?? "").slice(0, 10));
        setDueDate((r.project.due_date ?? "").slice(0, 10));
        setDatesReady(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, datesReady, project.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const dateError = datesReady ? dateOrderError(startDate, dueDate) : null;
    if (dateError) {
      setError(dateError);
      return;
    }
    setError("");
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description,
          department,
          status,
          ...(datesReady ? { startDate: startDate || null, dueDate: dueDate || null } : {}),
        }),
      });
      onSaved({
        name,
        description,
        department: department || null,
        status,
        start_date: datesReady ? startDate || null : (project.start_date ?? null),
        due_date: datesReady ? dueDate || null : (project.due_date ?? null),
      });
      toast("Project updated");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update project");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject() {
    if (!confirm("Delete this project and all its tasks? This cannot be undone.")) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${project.id}`, { method: "DELETE" });
      toast("Project deleted");
      router.push("/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete project");
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit project">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div>
          <label htmlFor="edit-project-name" className="mb-1 block text-sm font-medium text-slate-700">Name</label>
          <input
            id="edit-project-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="edit-project-description" className="mb-1 block text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            id="edit-project-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </div>
        <DepartmentSelect
          id="edit-project-department"
          value={department}
          onChange={setDepartment}
          hint="Every task in this project counts to this department."
        />
        <ProjectDatesFields
          idPrefix="edit-project"
          start={startDate}
          due={dueDate}
          onStart={setStartDate}
          onDue={setDueDate}
          disabled={!datesReady}
        />
        <div>
          <label htmlFor="edit-project-status" className="mb-1 block text-sm font-medium text-slate-700">Status</label>
          <select
            id="edit-project-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            className={inputClass}
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          {canDelete ? (
            <button
              type="button"
              onClick={deleteProject}
              disabled={busy}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Delete project
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
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
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
