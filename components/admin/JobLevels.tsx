"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";

export interface LevelRow {
  /** Null for a title people hold that isn't on the list yet. */
  id: number | null;
  title: string;
  level: number | null;
  people: number;
}

const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

function LevelSelect({
  id,
  value,
  onChange,
  label,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} figure w-28 disabled:opacity-60`}
    >
      <option value="">No level</option>
      {LEVELS.map((l) => (
        <option key={l} value={l}>
          Level {l}
        </option>
      ))}
    </select>
  );
}

/**
 * Job titles and the seniority level each carries. Titles are free text on
 * each person; this list only adds a number so seniority compares across
 * titles that are named differently. Removing a title leaves people's job
 * titles alone.
 */
export default function JobLevels({ levels }: { levels: LevelRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  // Levels just chosen, shown until the refreshed list arrives.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [busyTitle, setBusyTitle] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newLevel, setNewLevel] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<LevelRow | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const needLevel = levels.filter((l) => l.level === null).length;

  async function setLevel(row: LevelRow, value: string) {
    setPending((p) => ({ ...p, [row.title]: value }));
    setBusyTitle(row.title);
    try {
      await apiFetch("/api/designation-levels", {
        method: "PUT",
        body: JSON.stringify({ title: row.title, level: value ? Number(value) : null }),
      });
      toast(value ? `${row.title} is now level ${value}` : `${row.title} has no level now`);
      router.refresh();
    } catch (err) {
      setPending((p) => {
        const next = { ...p };
        delete next[row.title];
        return next;
      });
      toast(err instanceof Error ? err.message : "Could not save that level", "error");
    } finally {
      setBusyTitle(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      await apiFetch("/api/designation-levels", {
        method: "PUT",
        body: JSON.stringify({ title, level: newLevel ? Number(newLevel) : null }),
      });
      const existed = levels.some((l) => l.title.toLowerCase() === title.toLowerCase());
      toast(existed ? `${title} updated` : `${title} added`);
      setNewTitle("");
      setNewLevel("");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add that job title", "error");
    } finally {
      setAdding(false);
    }
  }

  async function confirmRemove() {
    if (!removing?.id) return;
    setRemoveBusy(true);
    try {
      await apiFetch(`/api/designation-levels?id=${removing.id}`, { method: "DELETE" });
      toast(`${removing.title} removed from the list`);
      const gone = removing.title;
      setPending((p) => {
        const next = { ...p };
        delete next[gone];
        return next;
      });
      setRemoving(null);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove that job title", "error");
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <section id="job-levels" aria-labelledby="levels-heading" className="scroll-mt-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="levels-heading" className="text-lg font-semibold text-slate-900">
          Job levels
        </h2>
        {needLevel > 0 && (
          <span className="text-sm font-medium text-amber-800">
            <span className="figure">{needLevel}</span> job {needLevel === 1 ? "title still needs" : "titles still need"} a level
          </span>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-600">
        Levels let you compare seniority across differently named job titles. Level 1 is the most junior; two titles can
        share a level.
      </p>

      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 bg-slate-50 px-4 py-3">
          <div className="min-w-0 flex-1 basis-48">
            <label htmlFor="new-level-title" className="mb-1 block text-xs font-medium text-slate-600">
              Add a job title
            </label>
            <input
              id="new-level-title"
              value={newTitle}
              maxLength={120}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Senior Engineer"
              className={`${inputClass} w-full`}
            />
          </div>
          <div>
            <label htmlFor="new-level-level" className="mb-1 block text-xs font-medium text-slate-600">
              Level
            </label>
            <LevelSelect id="new-level-level" value={newLevel} onChange={setNewLevel} label="Level for the new job title" />
          </div>
          <button
            type="submit"
            disabled={adding || !newTitle.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </form>

        {levels.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            No job titles yet. Add one above, or give someone a job title and it appears here.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {levels.map((row) => {
              const value = pending[row.title] ?? (row.level === null ? "" : String(row.level));
              const missing = row.level === null && !pending[row.title];
              return (
                <li
                  key={row.title}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 ${missing ? "bg-amber-50/60" : ""}`}
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="truncate font-medium text-slate-900">{row.title}</div>
                    <div className="text-xs text-slate-500">
                      <span className="figure">{row.people}</span> {row.people === 1 ? "person" : "people"}
                      {missing && <span className="ml-2 font-medium text-amber-800">Needs a level</span>}
                    </div>
                  </div>
                  <LevelSelect
                    value={value}
                    onChange={(v) => setLevel(row, v)}
                    label={`Level for ${row.title}`}
                    disabled={busyTitle === row.title}
                  />
                  {row.id !== null ? (
                    <button
                      type="button"
                      onClick={() => setRemoving(row)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                      aria-label={`Remove ${row.title}`}
                    >
                      Remove
                    </button>
                  ) : (
                    // Not on the list yet: choosing a level adds it.
                    <span className="w-[66px]" aria-hidden />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={`Remove “${removing?.title ?? ""}”?`}>
        <div className="space-y-4 text-sm text-slate-700">
          {removing && removing.people > 0 ? (
            <p>
              <strong className="text-slate-900">
                {removing.people} {removing.people === 1 ? "person has" : "people have"}
              </strong>{" "}
              this job title. They keep it; it just won&apos;t have a level any more, and it comes back here, waiting for a
              level.
            </p>
          ) : (
            <p>Nobody has this job title, so nobody is affected.</p>
          )}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setRemoving(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmRemove}
              disabled={removeBusy}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {removeBusy ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
