"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatRelative } from "@/lib/format";

export interface VaultEntry {
  id: number;
  name: string;
  url: string | null;
  username: string | null;
  project_id: number | null;
  project_name: string | null;
  updated_at: string;
  updated_by_name: string | null;
  views: number;
  last_viewed: string | null;
}

interface Revealed {
  username: string | null;
  password: string;
  notes: string | null;
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export default function CredentialsVault({
  initial,
  projects,
  configured,
  problem,
}: {
  initial: VaultEntry[];
  projects: { id: number; name: string }[];
  configured: boolean;
  problem: string | null;
}) {
  const { toast } = useToast();
  const [entries, setEntries] = useState(initial);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VaultEntry | null>(null);
  // Which one is open, and what it said. Kept only while the page is open:
  // closing the row or leaving the page forgets it.
  const [shown, setShown] = useState<Record<number, Revealed>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  async function reload() {
    const res = await apiFetch<{ credentials: VaultEntry[] }>("/api/credentials");
    setEntries(res.credentials);
  }

  async function reveal(entry: VaultEntry) {
    setBusyId(entry.id);
    try {
      const res = await apiFetch<Revealed>(`/api/credentials/${entry.id}/reveal`, {
        method: "POST",
      });
      setShown((prev) => ({ ...prev, [entry.id]: res }));
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not read it", "error");
    } finally {
      setBusyId(null);
    }
  }

  function hide(id: number) {
    setShown((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      toast("Copy failed — select it and copy", "error");
    }
  }

  async function remove(entry: VaultEntry) {
    if (!confirm(`Delete "${entry.name}"? The record of who read it is kept.`)) return;
    try {
      await apiFetch(`/api/credentials/${entry.id}`, { method: "DELETE" });
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      toast("Deleted");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete it", "error");
    }
  }

  return (
    <div>
      {!configured && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <strong className="font-semibold">Not set up yet.</strong> {problem}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Logins for websites the team shares. Stored encrypted, admin only, and
          every reveal is recorded below.
        </p>
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          disabled={!configured}
          title={configured ? undefined : "Set CREDENTIALS_KEY first"}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          + Add login
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">
          Nothing saved yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => {
            const open = shown[e.id];
            return (
              <li
                key={e.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{e.name}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-600">
                      {e.url ? (
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-indigo-600 hover:underline"
                        >
                          {e.url}
                        </a>
                      ) : (
                        <span className="text-slate-400">no address</span>
                      )}
                      {e.username ? ` · ${e.username}` : ""}
                      {e.project_name ? ` · ${e.project_name}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {e.views > 0
                        ? `Read ${e.views} time${e.views === 1 ? "" : "s"}${
                            e.last_viewed ? `, last ${formatRelative(e.last_viewed)}` : ""
                          }`
                        : "Never read"}
                      {e.updated_by_name ? ` · saved by ${e.updated_by_name}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {open ? (
                      <button
                        onClick={() => hide(e.id)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Hide
                      </button>
                    ) : (
                      <button
                        onClick={() => reveal(e)}
                        disabled={busyId === e.id}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                      >
                        {busyId === e.id ? "Reading…" : "Show password"}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditing(e);
                        setFormOpen(true);
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(e)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <dl className="space-y-2 text-sm">
                      {open.username && (
                        <div className="flex items-center gap-2">
                          <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            User
                          </dt>
                          <dd className="font-mono text-slate-800">{open.username}</dd>
                          <button
                            onClick={() => copy(open.username ?? "", "Username")}
                            className="ml-auto text-xs font-medium text-indigo-600 hover:underline"
                          >
                            Copy
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Password
                        </dt>
                        <dd className="break-all font-mono text-slate-800">
                          {open.password}
                        </dd>
                        <button
                          onClick={() => copy(open.password, "Password")}
                          className="ml-auto shrink-0 text-xs font-medium text-indigo-600 hover:underline"
                        >
                          Copy
                        </button>
                      </div>
                      {open.notes && (
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Notes
                          </dt>
                          <dd className="whitespace-pre-wrap text-slate-700">
                            {open.notes}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {formOpen && (
        <CredentialForm
          entry={editing}
          projects={projects}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function CredentialForm({
  entry,
  projects,
  onClose,
  onSaved,
}: {
  entry: VaultEntry | null;
  projects: { id: number; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(entry?.name ?? "");
  const [url, setUrl] = useState(entry?.url ?? "");
  const [username, setUsername] = useState(entry?.username ?? "");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [projectId, setProjectId] = useState<string>(
    entry?.project_id ? String(entry.project_id) : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        name,
        url: url.trim() || null,
        username: username.trim() || null,
        notes: notes.trim() || null,
        projectId: projectId ? Number(projectId) : null,
        ...(password ? { password } : {}),
      };
      if (entry) {
        await apiFetch(`/api/credentials/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch("/api/credentials", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      toast(entry ? "Saved" : "Login added");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save it");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={entry ? "Edit login" : "Add a login"}>
      <form onSubmit={submit} className="space-y-3">
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div>
          <label htmlFor="cred-name" className="mb-1 block text-sm font-medium text-slate-700">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="cred-name"
            required
            maxLength={200}
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            placeholder="Dealer portal (admin account)"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="cred-url" className="mb-1 block text-sm font-medium text-slate-700">
            Website <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id="cred-url"
            type="url"
            maxLength={500}
            value={url}
            onChange={(ev) => setUrl(ev.target.value)}
            placeholder="https://portal.example.com/login"
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="cred-user"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Username <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input
              id="cred-user"
              maxLength={255}
              value={username}
              onChange={(ev) => setUsername(ev.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="cred-pass"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Password {!entry && <span className="text-red-500">*</span>}
            </label>
            <input
              id="cred-pass"
              type="password"
              required={!entry}
              maxLength={500}
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              placeholder={entry ? "Leave blank to keep the current one" : ""}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor="cred-project" className="mb-1 block text-sm font-medium text-slate-700">
            Project <span className="font-normal text-slate-500">(optional, for grouping)</span>
          </label>
          <select
            id="cred-project"
            value={projectId}
            onChange={(ev) => setProjectId(ev.target.value)}
            className={inputClass}
          >
            <option value="">Not tied to a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cred-notes" className="mb-1 block text-sm font-medium text-slate-700">
            Notes <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <p className="mb-1 text-xs text-slate-500">
            Encrypted like the password — security questions and recovery codes belong
            here, not in a task comment.
          </p>
          <textarea
            id="cred-notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(ev) => setNotes(ev.target.value)}
            placeholder={entry ? "Leave blank to clear the saved notes" : ""}
            className={inputClass}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
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
            {busy ? "Saving…" : entry ? "Save" : "Add login"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
