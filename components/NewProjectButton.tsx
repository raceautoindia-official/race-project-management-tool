"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "./ToastProvider";
import type { ProjectTemplate } from "@/lib/types";

interface PickUser {
  id: number;
  name: string;
  email: string;
}

export default function NewProjectButton({ users }: { users: PickUser[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("active");
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Load available templates when the modal opens.
  useEffect(() => {
    if (!open) return;
    apiFetch<{ templates: ProjectTemplate[] }>("/api/templates")
      .then((r) => setTemplates(r.templates))
      .catch(() => setTemplates([]));
  }, [open]);

  function reset() {
    setName("");
    setDescription("");
    setStatus("active");
    setMemberIds([]);
    setTemplateId("");
    setError("");
  }

  function toggleMember(id: number) {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (templateId) {
        // Instantiate a full project (labels/tasks/milestones) from a template.
        const res = await apiFetch<{ project: { id: number } }>(
          `/api/templates/${templateId}/instantiate`,
          { method: "POST", body: JSON.stringify({ name }) }
        );
        setOpen(false);
        reset();
        toast("Project created from template");
        router.push(`/projects/${res.project.id}`);
        return;
      }
      await apiFetch("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name, description, status, memberIds }),
      });
      setOpen(false);
      reset();
      toast("Project created");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  }

  const usingTemplate = Boolean(templateId);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        + New project
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create project">
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {templates.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Start from
              </label>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Blank project</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.task_count != null ? ` (${t.task_count} tasks)` : ""}
                  </option>
                ))}
              </select>
              {usingTemplate && (
                <p className="mt-1 text-xs text-slate-400">
                  Labels, tasks and milestones from the template are copied into
                  the new project.
                </p>
              )}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Name
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          {!usingTemplate && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Members
                </label>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {users.length === 0 ? (
                    <p className="px-1 text-sm text-slate-400">No users available</p>
                  ) : (
                    users.map((u) => (
                      <label
                        key={u.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={memberIds.includes(u.id)}
                          onChange={() => toggleMember(u.id)}
                        />
                        <span className="text-slate-700">{u.name}</span>
                        <span className="text-xs text-slate-400">{u.email}</span>
                      </label>
                    ))
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  You are automatically added as the project lead.
                </p>
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy
                ? "Creating…"
                : usingTemplate
                  ? "Create from template"
                  : "Create project"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
