"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "./ToastProvider";
import type { ProjectTemplate } from "@/lib/types";
import MoreFields from "@/components/MoreFields";
import { DepartmentSelect } from "@/components/DepartmentField";
import TemplatePicker from "@/components/TemplatePicker";
import ProjectDatesFields, { dateOrderError } from "@/components/ProjectDatesFields";
import PeoplePicker from "@/components/PeoplePicker";
import { FilesField, filesOk, uploadFiles } from "@/components/work/AttachFiles";
import { todayIST } from "@/lib/work-dates";

interface PickUser {
  id: number;
  name: string;
  email: string;
  /** Their job title, from Attendance — who you are picking, not just a name. */
  designation?: string | null;
  /** Their department, so the lists read like the organisation does. */
  department?: string | null;
  /** Admin, or lead of an approved project — the only people who can approve. */
  canLead?: boolean;
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/**
 * Starting a project, in the order the questions come up: what it starts
 * from (admins with templates), what it is called and is for, who runs it
 * and where it belongs, when, who is on it, and any files to begin with.
 *
 * Admins create directly; everyone else requests one, and the manager they
 * name is the person who approves it. A template is a starting shape only:
 * the manager, people, department, description and dates on the form apply
 * to it exactly as they do to a blank project.
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
  const errorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState(defaultDepartment ?? "");
  const [memberIds, setMemberIds] = useState<number[]>([]);
  // An admin runs what they create unless they hand it to someone; a
  // requester must name the person who will.
  const [managerId, setManagerId] = useState(isAdmin ? String(currentUserId) : "");
  const [startDate, setStartDate] = useState(() => todayIST());
  const [dueDate, setDueDate] = useState("");
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

  // A problem is shown next to the button that caused it, in view.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);

  function reset() {
    setName("");
    setDescription("");
    setDepartment(defaultDepartment ?? "");
    setMemberIds([]);
    setManagerId(isAdmin ? String(currentUserId) : "");
    setStartDate(todayIST());
    setDueDate("");
    setFiles([]);
    setTemplateId("");
    setError("");
  }

  function chooseManager(id: string) {
    setManagerId(id);
    // The manager leads it; they are not also a plain member.
    setMemberIds((prev) => prev.filter((m) => String(m) !== id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const dateError = dateOrderError(startDate, dueDate);
    if (dateError) {
      setError(dateError);
      return;
    }
    if (!filesOk(files)) {
      setError("Remove the files over 10 MB first.");
      return;
    }
    setError("");
    setBusy(true);
    // The same answers whichever way the project is made.
    const common = {
      name,
      description,
      department,
      memberIds,
      startDate: startDate || null,
      dueDate: dueDate || null,
    };
    try {
      let projectId: number;
      if (templateId) {
        const res = await apiFetch<{ project: { id: number } }>(`/api/templates/${templateId}/instantiate`, {
          method: "POST",
          body: JSON.stringify({ ...common, ownerId: Number(managerId) || undefined }),
        });
        projectId = res.project.id;
      } else {
        const res = await apiFetch<{ project: { id: number } }>("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            ...common,
            // The same dropdown means "who runs it" to an admin and "who
            // approves it" to everyone else.
            ...(isAdmin ? { ownerId: Number(managerId) || undefined } : { leadId: Number(managerId) }),
          }),
        });
        projectId = res.project.id;
      }

      // The project exists before its files can hang off it, so this runs after.
      const failed = files.length ? await uploadFiles(`/api/projects/${projectId}/attachments`, files) : [];
      setOpen(false);
      reset();
      if (failed.length) {
        // The project is real either way — say which files did not make it
        // rather than pretend they did.
        toast(`Project created, but ${failed.length === 1 ? "1 file" : `${failed.length} files`} did not upload: ${failed.join(", ")}`, "error");
      } else if (templateId) {
        toast("Project created from the template");
      } else if (!isAdmin) {
        toast("Project created — the manager you chose will review it");
      } else {
        toast("Project created");
      }
      router.push(`/projects/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project");
    } finally {
      setBusy(false);
    }
  }

  const usingTemplate = Boolean(templateId);
  // An admin may hand a project to anyone; a request has to go to someone
  // who is allowed to approve it.
  const managerOptions = isAdmin ? users : users.filter((u) => u.id !== currentUserId && u.canLead);
  /** People grouped under their department — your own first, the unplaced last. */
  function byDepartment(list: PickUser[]): [string, PickUser[]][] {
    const groups = new Map<string, PickUser[]>();
    for (const u of list) {
      const key = u.department || "No department";
      groups.set(key, [...(groups.get(key) ?? []), u]);
    }
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === "No department") return 1;
      if (b[0] === "No department") return -1;
      const mine = (n: string) => (defaultDepartment && n === defaultDepartment ? 0 : 1);
      return mine(a[0]) - mine(b[0]) || a[0].localeCompare(b[0]);
    });
  }

  // Already on the project whatever the picker says: shown, not removable.
  const fixed = [
    ...(managerId ? [{ id: Number(managerId), note: isAdmin ? "Manager" : "Manager — approves it" }] : []),
    ...(!isAdmin && String(currentUserId) !== managerId ? [{ id: currentUserId, note: "You — requester" }] : []),
  ];

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
        onClose={() => !busy && setOpen(false)}
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

          {/* What it starts from changes what the rest of the form makes, so it comes first. */}
          {isAdmin && templates.length > 0 && (
            <MoreFields
              label="Start from a template"
              hint="Blank project"
              summary={usingTemplate ? templates.find((t) => String(t.id) === templateId)?.name : undefined}
              defaultOpen={usingTemplate}
            >
              <TemplatePicker templates={templates} value={templateId} onChange={setTemplateId} myDepartment={defaultDepartment} />
              {usingTemplate && (
                <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                  Its labels, tasks, subtasks and milestones are copied in. The manager, people,
                  department and dates below still apply. Nothing stays linked to the template.
                </p>
              )}
            </MoreFields>
          )}

          <div>
            <label htmlFor="project-name" className="mb-1 block text-sm font-medium text-slate-700">
              Project name <span className="text-red-500">*</span>
            </label>
            <input
              id="project-name"
              required
              autoFocus
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dealer portal refresh"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="project-description" className="mb-1 block text-sm font-medium text-slate-700">
              Description <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="One or two lines on the goal, so everyone added knows why it exists."
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
                onChange={(e) => chooseManager(e.target.value)}
                className={inputClass}
              >
                <option value="">Choose a manager…</option>
                {byDepartment(managerOptions).map(([dept, people]) => (
                  <optgroup key={dept} label={dept}>
                    {people.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                        {u.id === currentUserId ? " (you)" : ""}
                        {u.designation ? ` — ${u.designation}` : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-600">
                {isAdmin ? "They own the project and approve its tasks." : "They approve this project, then own it."}
                {!isAdmin && managerOptions.length === 0 && " Nobody can approve projects yet — ask an admin."}
              </p>
            </div>
            <DepartmentSelect
              id="project-department"
              value={department}
              onChange={setDepartment}
              hint="Its tasks count to this department too."
            />
          </div>

          <ProjectDatesFields idPrefix="project" start={startDate} due={dueDate} onStart={setStartDate} onDue={setDueDate} />

          <div>
            <span id="project-people-label" className="mb-1 block text-sm font-medium text-slate-700">
              Who is working on it <span className="font-normal text-slate-500">(optional — you can add people later)</span>
            </span>
            <PeoplePicker
              label="Add people to the project"
              people={users}
              value={memberIds}
              onChange={setMemberIds}
              fixed={fixed}
              myDepartment={defaultDepartment}
            />
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Files <span className="font-normal text-slate-500">(optional)</span>
            </span>
            <FilesField files={files} onChange={setFiles} hint="The brief, a drawing, the customer's email. Up to 10 MB each." />
          </div>

          {error && (
            <div ref={errorRef} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim() || !managerId}
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
