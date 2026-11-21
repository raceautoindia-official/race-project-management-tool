"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { RoleBadge } from "@/components/Badge";
import Avatar from "@/components/Avatar";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { PersonSelect } from "@/components/work/kit";
import type { ProjectMember } from "@/lib/types";

interface PickUser {
  id: number;
  name: string;
  email: string;
  /** Shown in the picker so you can tell who you are adding. */
  department?: string | null;
  designation?: string | null;
}

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export default function MembersModal({
  open,
  onClose,
  projectId,
  ownerId,
  members,
  allUsers,
  onChanged,
  canChangeOwner = false,
  onOwnerChanged,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  ownerId: number | null;
  members: ProjectMember[];
  allUsers: PickUser[];
  onChanged: (members: ProjectMember[]) => void;
  /** The project's owner or an admin may hand the project to someone else. */
  canChangeOwner?: boolean;
  onOwnerChanged?: (owner: { id: number; name: string }) => void;
}) {
  const { toast } = useToast();
  const [userId, setUserId] = useState<number | null>(null);
  const [role, setRole] = useState("member");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handingTo, setHandingTo] = useState<number | null>(null);

  const memberIds = new Set(members.map((m) => m.user_id));
  const candidates = allUsers.filter((u) => !memberIds.has(u.id));

  async function refresh() {
    const data = await apiFetch<{ members: ProjectMember[] }>(
      `/api/projects/${projectId}/members`
    );
    onChanged(data.members);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setError("");
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId, roleInProject: role }),
      });
      setUserId(null);
      setRole("member");
      await refresh();
      toast("Member added");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add member");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(memberUserId: number, roleInProject: string) {
    setError("");
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${projectId}/members`, {
        method: "PATCH",
        body: JSON.stringify({ userId: memberUserId, roleInProject }),
      });
      await refresh();
      toast(roleInProject === "lead" ? "Now a lead of this project" : "Now a member of this project");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the role");
    } finally {
      setBusy(false);
    }
  }

  async function makeOwner(m: ProjectMember) {
    setError("");
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ ownerId: m.user_id }) });
      await refresh();
      onOwnerChanged?.({ id: m.user_id, name: m.name });
      setHandingTo(null);
      toast(`${m.name} now owns this project`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the owner");
    } finally {
      setBusy(false);
    }
  }

  async function remove(memberUserId: number) {
    setError("");
    setBusy(true);
    try {
      await apiFetch(
        `/api/projects/${projectId}/members?userId=${memberUserId}`,
        { method: "DELETE" }
      );
      await refresh();
      toast("Member removed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove member");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage members">
      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <p className="mb-2 text-xs text-slate-500">
        A <strong className="font-medium text-slate-700">lead</strong> can add tasks, approve finished work and sign it off. A{" "}
        <strong className="font-medium text-slate-700">member</strong> does the work given to them. The <strong className="font-medium text-slate-700">owner</strong>{" "}
        is the lead who runs the project.
      </p>
      <ul className="mb-4 divide-y divide-slate-100">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <Avatar name={m.name} size="md" />
              <div>
                <div className="text-sm font-medium text-slate-800">{m.name}</div>
                <div className="text-xs text-slate-500">
                  {[m.designation, m.department].filter(Boolean).join(" · ") || m.email}
                </div>
              </div>
            </div>
            {m.user_id === ownerId ? (
              <div className="flex items-center gap-3">
                <RoleBadge role={m.role_in_project} />
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">Owner</span>
              </div>
            ) : handingTo === m.user_id ? (
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-700">
                Make {m.name.split(" ")[0]} the owner? They’ll run the project; the current owner stays a lead.
                <button onClick={() => makeOwner(m)} disabled={busy} className="rounded-lg bg-indigo-600 px-2.5 py-1 font-semibold text-white disabled:opacity-50">
                  Yes
                </button>
                <button onClick={() => setHandingTo(null)} className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-600">
                  No
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <select
                  aria-label={`${m.name}'s role in this project`}
                  value={m.role_in_project}
                  disabled={busy}
                  onChange={(e) => changeRole(m.user_id, e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                >
                  <option value="member">Member</option>
                  <option value="lead">Lead</option>
                </select>
                {canChangeOwner && (
                  <button onClick={() => setHandingTo(m.user_id)} disabled={busy} className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50">
                    Make owner
                  </button>
                )}
                <button
                  onClick={() => remove(m.user_id)}
                  disabled={busy}
                  className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="add-member-user" className="mb-1 block text-xs font-medium text-slate-600">
            Add member
          </label>
          {/* Grouped by department, each with their job title. */}
          <PersonSelect
            id="add-member-user"
            people={candidates.map((u) => ({
              user_id: u.id,
              name: u.name,
              department: u.department,
              designation: u.designation,
            }))}
            value={userId}
            onChange={setUserId}
            emptyLabel="Select a person…"
            className="w-full"
          />
        </div>
        <select
          aria-label="Role in project"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className={inputClass}
        >
          <option value="member">Member</option>
          <option value="lead">Lead</option>
        </select>
        <button
          type="submit"
          disabled={busy || !userId}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </Modal>
  );
}
