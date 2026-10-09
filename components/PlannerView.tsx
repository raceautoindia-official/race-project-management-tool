"use client";

import { useState } from "react";
import Avatar from "@/components/Avatar";
import DailySummaryPanel from "@/components/DailySummary";
import { summaryLine, type DailySummary } from "@/lib/daily-summary-shape";
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
  initialSummary,
  initialTeamLines,
  canSeeOthers,
  currentUserId,
}: {
  initialPeriod: PlannerPeriod;
  initialDate: string;
  initialEntry: PlannerEntry | null;
  initialTeam: PlannerEntry[];
  /** The day as the app recorded it — null on the weekly tab. */
  initialSummary: DailySummary | null;
  /** One line each for the team, same source. */
  initialTeamLines: Record<number, string>;
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
  const [summary, setSummary] = useState<DailySummary | null>(initialSummary);
  const [teamLines, setTeamLines] = useState<Record<number, string>>(initialTeamLines);
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
      let others: PlannerEntry[] = [];
      if (canSeeOthers) {
        const res = await apiFetch<{ entries: PlannerEntry[] }>(
          `/api/planner?scope=team&period=${nextPeriod}&date=${nextDate}`
        );
        others = res.entries;
        setTeam(others);
      }

      // The day works itself out; a week is a plan, which nobody can.
      if (nextPeriod === "day") {
        const s = await apiFetch<{ summary: DailySummary }>(
          `/api/planner/summary?date=${nextDate}`
        );
        setSummary(s.summary);
        const lines = await Promise.all(
          others
            .filter((o) => o.user_id !== currentUserId)
            .map(async (o) => {
              const r = await apiFetch<{ summary: DailySummary }>(
                `/api/planner/summary?date=${nextDate}&userId=${o.user_id}`
              );
              return [o.user_id as number, summaryLine(r.summary)] as const;
            })
        );
        setTeamLines(Object.fromEntries(lines.filter(([, l]) => l)));
      } else {
        setSummary(null);
        setTeamLines({});
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
      <div
        role="tablist"
        aria-label="Planner"
        className="mb-4 flex gap-1 border-b border-slate-200"
      >
        {(
          [
            ["day", "Daily summary"],
            ["week", "Weekly plan"],
          ] as [PlannerPeriod, string][]
        ).map(([p, label]) => (
          <button
            key={p}
            role="tab"
            aria-selected={period === p}
            onClick={() => void load(p, date)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
              period === p
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
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

      {period === "day" && summary && (
        <div className="mb-4">
          <DailySummaryPanel summary={summary} />
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">
          {period === "day" ? "In my own words" : "My week"}
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
          placeholder={
            period === "day"
              ? "One line per thing:\nFinish the dealer CSV export\nCall the client about the portal"
              : "What this week is for:\nShip the dealer export\nClear the contact-form backlog"
          }
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
          placeholder={
            period === "day"
              ? "Filled in at the end of the day — what happened, and what did not."
              : "Filled in at the end of the week — what landed, and what slipped."
          }
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
                    {period === "day" && teamLines[t.user_id as number] && (
                      <p className="mb-2 text-xs text-slate-600">
                        <span className="font-medium">Recorded:</span>{" "}
                        {teamLines[t.user_id as number]}
                      </p>
                    )}
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
