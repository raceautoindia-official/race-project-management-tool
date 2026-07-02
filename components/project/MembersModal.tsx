"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { RoleBadge } from "@/components/Badge";
import Avatar from "@/components/Avatar";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import type { ProjectMember } from "@/lib/types";

interface PickUser {
  id: number;
  name: string;
  email: string;
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
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  ownerId: number | null;
  members: ProjectMember[];
  allUsers: PickUser[];
  onChanged: (members: ProjectMember[]) => void;
}) {
  const { toast } = useToast();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
        body: JSON.stringify({ userId: Number(userId), roleInProject: role }),
      });
      setUserId("");
      setRole("member");
      await refresh();
      toast("Member added");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add member");
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

      <ul className="mb-4 divide-y divide-slate-100">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <Avatar name={m.name} size="md" />
              <div>
                <div className="text-sm font-medium text-slate-800">{m.name}</div>
                <div className="text-xs text-slate-400">{m.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <RoleBadge role={m.role_in_project} />
              {m.user_id === ownerId ? (
                <span className="text-xs text-slate-400">Owner</span>
              ) : (
                <button
                  onClick={() => remove(m.user_id)}
                  disabled={busy}
                  className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Add member
          </label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={`${inputClass} w-full`}
          >
            <option value="">Select a user…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </div>
        <select
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
