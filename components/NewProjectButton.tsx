"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "./ToastProvider";
import type { ProjectTemplate } from "@/lib/types";
import MoreFields from "@/components/MoreFields";
import { DepartmentSelect } from "@/components/DepartmentField";
import TemplatePicker from "@/components/TemplatePicker";

interface PickUser {
  id: number;
  name: string;
  email: string;
  /** Their job title, from Attendance — who you are picking, not just a name. */
  designation?: string | null;
  /** Admin, or lead of an approved project — the only people who can approve. */
  canLead?: boolean;
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/** 10 MB, the same ceiling task attachments have. */
const MAX_BYTES = 10 * 1024 * 1024;

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Starting a project: what it is called, who runs it, who is on it, and
 * whatever it starts from.
 *
 * Those four are the questions a project actually raises, so they are all on
 * screen rather than folded away. Admins create directly; everyone else
 * requests one, and the manager they name is the person who approves it.
 */
export default function NewProjectButton({
  users,
  isAdmin,
  currentUserId,
  defaultDepartment,
}: {
  users: PickUser[];
  isAdmin: boolean;
  currentUserId: number;
  /** The creator's own department — where their work normally belongs. */
  defaultDepartment?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState(defaultDepartment ?? "");
  const [memberIds, setMemberIds] = useState<number[]>([]);
  // An admin runs what they create unless they hand it to someone; a
  // requester must name the person who will.
  const [managerId, setManagerId] = useState(isAdmin ? String(currentUserId) : "");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [files, setFiles] = useState<File[]>([]);
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
    setDepartment(defaultDepartment ?? "");
    setMemberIds([]);
    setManagerId(isAdmin ? String(currentUserId) : "");
    setPeopleQuery("");
    setFiles([]);
    setTemplateId("");
    setError("");
  }

  function toggleMember(id: number) {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    const tooBig = [...picked].filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) {
      toast(`${tooBig[0].name} is over 10 MB and was not added`, "error");
    }
    const ok = [...picked].filter((f) => f.size > 0 && f.size <= MAX_BYTES);
    // Same file picked twice is still one file.
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...ok.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  }

  /** The project exists before its files can hang off it, so this runs after. */
  async function uploadFiles(projectId: number): Promise<string[]> {
    const failed: string[] = [];
    for (const file of files) {
      const body = new FormData();
      body.append("file", file);
      try {
        await apiFetch(`/api/projects/${projectId}/attachments`, {
          method: "POST",
          body,
        });
      } catch {
        failed.push(file.name);
      }
    }
    return failed;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      let projectId: number;
      if (templateId) {
        // Instantiate a full project (labels/tasks/milestones) from a template.
        const res = await apiFetch<{ project: { id: number } }>(
          `/api/templates/${templateId}/instantiate`,
          { method: "POST", body: JSON.stringify({ name }) }
        );
        projectId = res.project.id;
      } else {
        const res = await apiFetch<{ project: { id: number } }>("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            name,
            description,
            department,
            memberIds,
            // The same dropdown means "who runs it" to an admin and "who
            // approves it" to everyone else.
            ...(isAdmin
              ? { ownerId: Number(managerId) || undefined }
              : { leadId: Number(managerId) }),
          }),
        });
        projectId = res.project.id;
      }

      const failed = files.length ? await uploadFiles(projectId) : [];
      setOpen(false);
      reset();
      if (failed.length) {
        // The project is real either way — say which files did not make it
        // rather than pretend they did.
        toast(
          `Project created, but ${failed.length} file${
            failed.length === 1 ? "" : "s"
          } did not upload: ${failed.join(", ")}`,
          "error"
        );
      } else if (templateId) {
        toast("Project created from template");
      } else if (!isAdmin) {
        toast("Project created — the manager you chose will review it");
      } else {
        toast("Project created");
      }
      router.push(`/projects/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  }

  const usingTemplate = Boolean(templateId);
  // An admin may hand a project to anyone; a request has to go to someone
  // who is allowed to approve it.
  const managerOptions = isAdmin
    ? users
    : users.filter((u) => u.id !== currentUserId && u.canLead);
  const team = users.filter(
    (u) =>
      String(u.id) !== managerId &&
      (peopleQuery.trim() === "" ||
        u.name.toLowerCase().includes(peopleQuery.trim().toLowerCase()) ||
        (u.email ?? "").toLowerCase().includes(peopleQuery.trim().toLowerCase()) ||
        // Searching "engineer" should find the engineers.
        (u.designation ?? "").toLowerCase().includes(peopleQuery.trim().toLowerCase()))
  );

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
        widthClass="max-w-2xl"
      >
        <form onSubmit={submit} className="space-y-5">
          {!isAdmin && (
            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
              Your project is created straight away and starts once the manager you
              choose approves it. Until then it is read-only.
            </p>
          )}
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="project-name" className="mb-1 block text-sm font-medium text-slate-700">
              Project name <span className="text-red-500">*</span>
            </label>
            <input
              id="project-name"
              required
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dealer portal refresh"
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="project-manager" className="mb-1 block text-sm font-medium text-slate-700">
                Project manager <span className="text-red-500">*</span>
              </label>
              <select
                id="project-manager"
                required
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
                className={inputClass}
              >
                <option value="">Choose a manager…</option>
                {managerOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.id === currentUserId ? " (you)" : ""}
                    {u.designation ? ` — ${u.designation}` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-600">
                {isAdmin
                  ? "They lead the project and approve its work."
                  : "They approve this project, then lead it."}
              </p>
            </div>
            <DepartmentSelect
              id="project-department"
              value={department}
              onChange={setDepartment}
              hint="Its tasks count to this department too."
            />
          </div>

          <div>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-700">
                Who is working on this project
              </span>
              <span className="text-xs text-slate-600">
                {memberIds.length === 0
                  ? "Nobody added yet"
                  : `${memberIds.length} selected`}
              </span>
            </div>
            <input
              value={peopleQuery}
              onChange={(e) => setPeopleQuery(e.target.value)}
              placeholder="Search people…"
              aria-label="Search people"
              className={`${inputClass} mb-2`}
            />
            <div
              tabIndex={0}
              className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-2"
            >
              {team.length === 0 ? (
                <p className="px-1 py-2 text-sm text-slate-600">
                  {peopleQuery ? "Nobody matches that." : "No other users yet."}
                </p>
              ) : (
                team.map((u) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={memberIds.includes(u.id)}
                      onChange={() => toggleMember(u.id)}
                    />
                    <span className="text-slate-700">{u.name}</span>
                    <span className="truncate text-xs text-slate-500">
                      {u.designation || u.email}
                    </span>
                  </label>
                ))
              )}
            </div>
            <p className="mt-1 text-xs text-slate-600">
              The manager is on it already. More people can be added afterwards.
            </p>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Attachments <span className="font-normal text-slate-500">(optional)</span>
            </span>
            <input
              type="file"
              multiple
              aria-label="Attach files to this project"
              onChange={(e) => {
                addFiles(e.target.files);
                // Let the same file be chosen again after removing it.
                e.target.value = "";
              }}
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
            />
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${f.size}-${i}`}
                    className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm"
                  >
                    <span className="truncate text-slate-700">{f.name}</span>
                    <span className="figure shrink-0 text-xs text-slate-600">
                      {fileSize(f.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, x) => x !== i))}
                      aria-label={`Remove ${f.name}`}
                      className="ml-auto shrink-0 rounded px-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-slate-600">
              The brief, a drawing, the customer&rsquo;s email. Up to 10 MB each, added
              once the project exists.
            </p>
          </div>

          <div>
            <label htmlFor="project-description" className="mb-1 block text-sm font-medium text-slate-700">
              Description <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={inputClass}
            />
          </div>

          {isAdmin && templates.length > 0 && (
            <MoreFields
              label="Start from a template"
              hint="Blank project"
              summary={
                usingTemplate
                  ? templates.find((t) => String(t.id) === templateId)?.name
                  : undefined
              }
              defaultOpen={usingTemplate}
            >
              <TemplatePicker
                templates={templates}
                value={templateId}
                onChange={setTemplateId}
                myDepartment={defaultDepartment}
              />
              {usingTemplate && (
                <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                  Its labels, tasks and milestones are copied into the new project.
                  Nothing is linked afterwards — change either without touching the
                  other.
                </p>
              )}
            </MoreFields>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
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
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy
                ? files.length
                  ? "Creating and uploading…"
                  : "Creating…"
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
