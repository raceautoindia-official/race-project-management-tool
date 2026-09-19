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
  /** Admin, or lead of an approved project — the only people who can approve. */
  canLead?: boolean;
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/**
 * Admins create projects directly. Everyone else requests one: they nominate
 * the lead who must approve it before any work can start.
 */
export default function NewProjectButton({
  users,
  isAdmin,
  currentUserId,
}: {
  users: PickUser[];
  isAdmin: boolean;
  currentUserId: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("active");
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [leadId, setLeadId] = useState("");
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Load available templates when the modal opens (admins only).
  useEffect(() => {
    if (!open || !isAdmin) return;
    apiFetch<{ templates: ProjectTemplate[] }>("/api/templates")
      .then((r) => setTemplates(r.templates))
      .catch(() => setTemplates([]));
  }, [open, isAdmin]);

  function reset() {
    setName("");
    setDescription("");
    setStatus("active");
    setMemberIds([]);
    setLeadId("");
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
      if (!isAdmin) {
        const res = await apiFetch<{ project: { id: number } }>("/api/projects", {
          method: "POST",
          body: JSON.stringify({ name, description, leadId: Number(leadId) }),
        });
        setOpen(false);
        reset();
        toast("Project created — your lead will review it");
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
  const leads = users.filter((u) => u.id !== currentUserId && u.canLead);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        {isAdmin ? "+ New project" : "+ Create project"}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isAdmin ? "Create project" : "Create a project"}
      >
        <form onSubmit={submit} className="space-y-4">
          {!isAdmin && (
            <p className="text-sm text-slate-600">
              Your project is created straight away and starts once the lead you choose
              approves it. Until then it is read-only.
            </p>
          )}
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {isAdmin && templates.length > 0 && (
            <div>
              <label htmlFor="project-template" className="mb-1 block text-sm font-medium text-slate-700">
                Start from
              </label>
              <select
                id="project-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className={inputClass}
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
                <p className="mt-1 text-xs text-slate-500">
                  Labels, tasks and milestones from the template are copied into
                  the new project.
                </p>
              )}
            </div>
          )}
          <div>
            <label htmlFor="project-name" className="mb-1 block text-sm font-medium text-slate-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="project-name"
              required
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          {!usingTemplate && (
            <>
              <div>
                <label htmlFor="project-description" className="mb-1 block text-sm font-medium text-slate-700">
                  Description
                </label>
                <textarea
                  id="project-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={inputClass}
                />
              </div>
              {!isAdmin && (
                <div>
                  <label htmlFor="project-lead" className="mb-1 block text-sm font-medium text-slate-700">
                    Lead (approver) <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="project-lead"
                    required
                    value={leadId}
                    onChange={(e) => setLeadId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Choose a lead…</option>
                    {leads.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Only admins and existing project leads can approve. They will lead
                    the project; you are added as a member.
                  </p>
                </div>
              )}
              {isAdmin && (
                <>
                  <div>
                    <label htmlFor="project-status" className="mb-1 block text-sm font-medium text-slate-700">
                      Status
                    </label>
                    <select
                      id="project-status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className={inputClass}
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div>
                    <span className="mb-1 block text-sm font-medium text-slate-700">
                      Members
                    </span>
                    <div tabIndex={0} className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                      {users.length === 0 ? (
                        <p className="px-1 text-sm text-slate-500">No users available</p>
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
                            <span className="text-xs text-slate-500">{u.email}</span>
                          </label>
                        ))
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      You are automatically added as the project lead.
                    </p>
                  </div>
                </>
              )}
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
                ? isAdmin
                  ? "Creating…"
                  : "Creating…"
                : usingTemplate
                  ? "Create from template"
                  : isAdmin
                    ? "Create project"
                    : "Create project"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
