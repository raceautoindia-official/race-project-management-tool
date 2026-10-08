"use client";

import { useState } from "react";
import Avatar from "@/components/Avatar";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import {
  describePeriod,
  rangeBack,
  shiftPeriod,
  type PlannerPeriod,
} from "@/lib/planner";

export interface PlannerEntry {
  entry_date: string;
  period: PlannerPeriod;
  plan: string | null;
  progress: string | null;
  updated_at: string;
  user_id?: number;
  user_name?: string;
  emp_id?: string;
}

const textareaClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/**
 * Someone's planner for a day or a week, and — for a lead or an admin —
 * everyone else's for the same period.
 *
 * Written, not worked out: the app has no idea what you mean to do today
 * until you say so, which is the point of it.
 */
export default function PlannerView({
  initialPeriod,
  initialDate,
  initialEntry,
  initialTeam,
  canSeeOthers,
  currentUserId,
}: {
  initialPeriod: PlannerPeriod;
  initialDate: string;
  initialEntry: PlannerEntry | null;
  initialTeam: PlannerEntry[];
  canSeeOthers: boolean;
  currentUserId: number;
}) {
  const { toast } = useToast();
  const [period, setPeriod] = useState<PlannerPeriod>(initialPeriod);
  const [date, setDate] = useState(initialDate);
  const [plan, setPlan] = useState(initialEntry?.plan ?? "");
  const [progress, setProgress] = useState(initialEntry?.progress ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(initialEntry?.updated_at ?? null);
  const [team, setTeam] = useState<PlannerEntry[]>(initialTeam);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load(nextPeriod: PlannerPeriod, nextDate: string) {
    setLoading(true);
    try {
      const mine = await apiFetch<{ entry: PlannerEntry | null }>(
        `/api/planner?period=${nextPeriod}&date=${nextDate}`
      );
      setPlan(mine.entry?.plan ?? "");
      setProgress(mine.entry?.progress ?? "");
      setSavedAt(mine.entry?.updated_at ?? null);
      setDirty(false);
      if (canSeeOthers) {
        const others = await apiFetch<{ entries: PlannerEntry[] }>(
          `/api/planner?scope=team&period=${nextPeriod}&date=${nextDate}`
        );
        setTeam(others.entries);
      }
      setPeriod(nextPeriod);
      setDate(nextDate);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load that", "error");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const res = await apiFetch<{ entry: PlannerEntry | null }>("/api/planner", {
        method: "PUT",
        body: JSON.stringify({ period, date, plan, progress }),
      });
      setSavedAt(res.entry?.updated_at ?? null);
      setDirty(false);
      toast(res.entry ? "Saved" : "Entry removed");
      if (canSeeOthers) {
        const others = await apiFetch<{ entries: PlannerEntry[] }>(
          `/api/planner?scope=team&period=${period}&date=${date}`
        );
        setTeam(others.entries);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setBusy(false);
    }
  }

  const label = describePeriod(period, date);
  // A month of days, or a quarter of weeks — enough to be worth opening.
  const exportFrom = rangeBack(period, date, period === "day" ? 29 : 11);
  const exportHref = `/api/planner/export?period=${period}&from=${exportFrom}&to=${date}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
          {(["day", "week"] as PlannerPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => void load(p, date)}
              className={`px-3 py-1.5 text-sm font-medium ${
                period === p
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {p === "day" ? "Day" : "Week"}
            </button>
          ))}
        </div>

        <button
          onClick={() => void load(period, shiftPeriod(period, date, -1))}
          aria-label="Previous"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          ←
        </button>
        <span className="min-w-[9rem] text-center text-sm font-semibold text-slate-800">
          {loading ? "…" : label}
        </span>
        <button
          onClick={() => void load(period, shiftPeriod(period, date, 1))}
          aria-label="Next"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          →
        </button>

        <input
          type="date"
          value={date}
          aria-label="Jump to a date"
          onChange={(e) => e.target.value && void load(period, e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        />

        <a
          href={exportHref}
          className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ⤓ Download mine
        </a>
        {canSeeOthers && (
          <a
            href={`/api/planner/export?scope=team&period=${period}&date=${date}`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ⤓ Download the team&rsquo;s
          </a>
        )}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">
          My plan for {period === "day" ? "this day" : "this week"}
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          {savedAt
            ? `Last saved ${String(savedAt).replace("T", " ").slice(0, 16)}`
            : "Nothing written yet."}
        </p>

        <label htmlFor="planner-plan" className="mb-1 block text-sm font-medium text-slate-700">
          What I mean to do
        </label>
        <textarea
          id="planner-plan"
          rows={4}
          maxLength={4000}
          value={plan}
          onChange={(e) => {
            setPlan(e.target.value);
            setDirty(true);
          }}
          placeholder={"One line per thing:\nFinish the dealer CSV export\nCall the client about the portal"}
          className={textareaClass}
        />

        <label
          htmlFor="planner-progress"
          className="mb-1 mt-3 block text-sm font-medium text-slate-700"
        >
          How it went
        </label>
        <textarea
          id="planner-progress"
          rows={4}
          maxLength={4000}
          value={progress}
          onChange={(e) => {
            setProgress(e.target.value);
            setDirty(true);
          }}
          placeholder="Filled in at the end — what happened, and what did not."
          className={textareaClass}
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {dirty && <span className="text-xs text-amber-700">Not saved yet</span>}
          <span className="ml-auto text-xs text-slate-500">
            Clearing both boxes and saving removes the entry.
          </span>
        </div>
      </section>

      {canSeeOthers && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            The team — {label}
          </h2>
          {team.filter((t) => t.user_id !== currentUserId).length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              Nobody else has written anything for this {period}.
            </p>
          ) : (
            <ul className="space-y-3">
              {team
                .filter((t) => t.user_id !== currentUserId)
                .map((t) => (
                  <li
                    key={t.user_id}
                    className="rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Avatar name={t.user_name ?? "?"} size="sm" />
                      <span className="text-sm font-semibold text-slate-800">
                        {t.user_name}
                      </span>
                      {t.emp_id && (
                        <span className="text-xs text-slate-500">{t.emp_id}</span>
                      )}
                      <span className="ml-auto text-xs text-slate-500">
                        {String(t.updated_at).replace("T", " ").slice(0, 16)}
                      </span>
                    </div>
                    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Plan
                        </dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">
                          {t.plan || <span className="text-slate-500">—</span>}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          How it went
                        </dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">
                          {t.progress || <span className="text-slate-500">—</span>}
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
