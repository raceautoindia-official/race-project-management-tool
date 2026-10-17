"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatRelative } from "@/lib/format";

export type Visibility = "admins" | "project" | "people";

export interface VaultEntry {
  id: number;
  name: string;
  url: string | null;
  username: string | null;
  project_id: number | null;
  project_name: string | null;
  visibility: Visibility;
  /** Who saved it — theirs to change, and an admin's. */
  created_by: number | null;
  /** Whether it has named fields, so editing knows to fetch them. */
  has_fields?: boolean | number;
  owner_name: string | null;
  /** Names of the people it is shared with, when visibility is "people". */
  shared_with: string | null;
  updated_at: string;
  updated_by_name: string | null;
  views: number;
  last_viewed: string | null;
}

interface Person {
  id: number;
  name: string;
}

/** Said on each entry, so "who can see this" never has to be guessed. */
function whoCanSee(e: VaultEntry): string {
  if (e.visibility === "project") {
    return e.project_name ? `Everyone on ${e.project_name}` : "Everyone on its project";
  }
  if (e.visibility === "people") {
    return e.shared_with ? `Shared with ${e.shared_with}` : "Shared with nobody yet";
  }
  // An administrator can see everything, so "private" means these two and
  // nobody else — saying it that way is honest about who can read it.
  return "Private — only you and admins";
}

interface ExtraField {
  label: string;
  value: string;
}

interface Revealed {
  username: string | null;
  password: string;
  notes: string | null;
  /** Whatever else the site asks for, named by whoever saved it. */
  fields: ExtraField[];
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export default function CredentialsVault({
  initial,
  projects,
  people,
  sharedWith,
  isAdmin,
  currentUserId,
  configured,
  problem,
}: {
  initial: VaultEntry[];
  projects: Person[];
  people: Person[];
  /** Credential id → the people it is shared with (the ones you may change). */
  sharedWith: Record<number, number[]>;
  isAdmin: boolean;
  currentUserId: number;
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

      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          {isAdmin
            ? "Everyone's website logins. Stored encrypted, and every read is recorded."
            : "Website logins you have saved, and the ones shared with you. Each read is recorded."}
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
          Nothing saved yet. Add a login and it is yours — shared only with whoever
          you choose, and visible to an administrator.
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => {
            const open = shown[e.id];
            const mine = e.created_by === currentUserId;
            // Theirs to change, or an admin's. Everyone else may only read.
            const canEdit = isAdmin || mine;
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
                        <span className="text-slate-500">no address</span>
                      )}
                      {e.username ? ` · ${e.username}` : ""}
                      {e.project_name ? ` · ${e.project_name}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                        {whoCanSee(e)}
                      </span>{" "}
                      · {mine ? "Saved by you" : `Saved by ${e.owner_name ?? "someone"}`} ·{" "}
                      {e.views > 0
                        ? `Read ${e.views} time${e.views === 1 ? "" : "s"}${
                            e.last_viewed ? `, last ${formatRelative(e.last_viewed)}` : ""
                          }`
                        : "Never read"}
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
                    {canEdit && (
                      <>
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
                      </>
                    )}
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
                      {open.fields?.map((f, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <dt className="w-20 shrink-0 truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {f.label}
                          </dt>
                          <dd className="break-all font-mono text-slate-800">{f.value}</dd>
                          <button
                            onClick={() => copy(f.value, f.label)}
                            className="ml-auto shrink-0 text-xs font-medium text-indigo-600 hover:underline"
                          >
                            Copy
                          </button>
                        </div>
                      ))}
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
          people={people}
          initialPeople={editing ? (sharedWith[editing.id] ?? []) : []}
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
  people,
  initialPeople,
  onClose,
  onSaved,
}: {
  entry: VaultEntry | null;
  projects: Person[];
  people: Person[];
  initialPeople: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(entry?.name ?? "");
  const [url, setUrl] = useState(entry?.url ?? "");
  const [username, setUsername] = useState(entry?.username ?? "");
  // Anything else the site asks for: an account ID, the email it is under.
  // Named by the person saving it, because every site asks for something
  // different and columns would never keep up.
  const [fields, setFields] = useState<ExtraField[]>([]);

  // Editing has to start from what is stored, or saving would wipe it — and
  // the only way to see it is to read it, which is recorded like any read.
  useEffect(() => {
    if (!entry?.has_fields) return;
    let live = true;
    void (async () => {
      try {
        const res = await apiFetch<{ fields: ExtraField[] }>(
          `/api/credentials/${entry.id}/reveal`,
          { method: "POST" }
        );
        if (live && res.fields?.length) setFields(res.fields);
      } catch {
        // Leaving them blank would quietly drop them, so say nothing and
        // let the save be refused rather than silently lose them.
      }
    })();
    return () => {
      live = false;
    };
  }, [entry?.id, entry?.has_fields]);
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [projectId, setProjectId] = useState<string>(
    entry?.project_id ? String(entry.project_id) : ""
  );
  const [visibility, setVisibility] = useState<Visibility>(entry?.visibility ?? "admins");
  const [chosen, setChosen] = useState<number[]>(initialPeople);
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
        fields: fields
          .map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
          .filter((f) => f.label && f.value),
        projectId: projectId ? Number(projectId) : null,
        visibility,
        userIds: visibility === "people" ? chosen : [],
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
              Username <span className="text-red-500">*</span>
            </label>
            <input
              id="cred-user"
              required
              maxLength={255}
              value={username}
              onChange={(ev) => setUsername(ev.target.value)}
              placeholder="The user ID you sign in with"
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
        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">
            Anything else it needs{" "}
            <span className="font-normal text-slate-500">(optional)</span>
          </legend>
          <p className="mb-2 text-xs text-slate-500">
            An account ID, the email it is registered to, a customer number — name it
            yourself. Encrypted like the password.
            {entry?.has_fields ? " Opening this counted as a read, as it does anywhere else." : ""}
          </p>
          {fields.length > 0 && (
            <div className="mb-2 space-y-1.5">
              {fields.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={f.label}
                    maxLength={60}
                    aria-label={`Field ${i + 1} name`}
                    placeholder="Account ID"
                    onChange={(ev) =>
                      setFields((prev) =>
                        prev.map((x, n) => (n === i ? { ...x, label: ev.target.value } : x))
                      )
                    }
                    className="w-1/3 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    value={f.value}
                    maxLength={500}
                    aria-label={`Field ${i + 1} value`}
                    placeholder="RACE-10294"
                    onChange={(ev) =>
                      setFields((prev) =>
                        prev.map((x, n) => (n === i ? { ...x, value: ev.target.value } : x))
                      )
                    }
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setFields((prev) => prev.filter((_, n) => n !== i))}
                    aria-label={`Remove field ${i + 1}`}
                    className="rounded px-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setFields((prev) => [...prev, { label: "", value: "" }])}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            + Add a field
          </button>
        </fieldset>

        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">Who can see it</legend>
          <div className="space-y-1.5">
            {(
              [
                [
                  "admins",
                  "Private",
                  "Only you — and an administrator, who can see everything in here.",
                ],
                [
                  "project",
                  "Everyone on its project",
                  "Anyone who is a member of the project chosen above.",
                ],
                ["people", "Named people", "Only the people you pick."],
              ] as [Visibility, string, string][]
            ).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="cred-visibility"
                  value={value}
                  checked={visibility === value}
                  onChange={() => setVisibility(value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-slate-800">{label}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {visibility === "people" && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {people.map((person) => (
                <label key={person.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    checked={chosen.includes(person.id)}
                    onChange={(ev) =>
                      setChosen((prev) =>
                        ev.target.checked
                          ? [...prev, person.id]
                          : prev.filter((x) => x !== person.id)
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="text-slate-700">{person.name}</span>
                </label>
              ))}
            </div>
          )}
          {visibility === "project" && !projectId && (
            <p className="mt-2 text-xs text-amber-700">
              Pick the project above — otherwise there is nobody this would share it with.
            </p>
          )}
        </fieldset>

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
