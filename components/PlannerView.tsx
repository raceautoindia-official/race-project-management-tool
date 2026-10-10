"use client";

import { useState } from "react";
import Avatar from "@/components/Avatar";
import DailySummaryPanel from "@/components/DailySummary";
import PointsInput, { pointsOf } from "@/components/project/PointsInput";
import WeekSummaryPanel from "@/components/WeekSummary";
import {
  summaryLine,
  type DailySummary,
  type WeekSummary,
} from "@/lib/planner-summary-shape";
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
  initialWeek,
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
  /** The week from the board — null on the daily tab. */
  initialWeek: WeekSummary | null;
  /** One line each for the team, same source. */
  initialTeamLines: Record<number, string>;
  canSeeOthers: boolean;
  currentUserId: number;
}) {
  const { toast } = useToast();
  type Tab = "day" | "week-plan" | "week-summary";
  const [tab, setTab] = useState<Tab>(
    initialPeriod === "week" ? "week-plan" : "day"
  );
  const period: PlannerPeriod = tab === "day" ? "day" : "week";
  const [date, setDate] = useState(initialDate);
  const [plan, setPlan] = useState(initialEntry?.plan ?? "");
  const [progress, setProgress] = useState(initialEntry?.progress ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(initialEntry?.updated_at ?? null);
  const [team, setTeam] = useState<PlannerEntry[]>(initialTeam);
  const [summary, setSummary] = useState<DailySummary | null>(initialSummary);
  const [week, setWeek] = useState<WeekSummary | null>(initialWeek);
  const [teamLines, setTeamLines] = useState<Record<number, string>>(initialTeamLines);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  // The list of lines holds its own editing state, so adding from outside it
  // has to re-seed it. Bumping this remounts it around the new value.
  const [planSeed, setPlanSeed] = useState(0);

  async function load(nextTab: Tab, nextDate: string) {
    const nextPeriod: PlannerPeriod = nextTab === "day" ? "day" : "week";
    // Both halves of a week come from one entry, so switching between them
    // needs no round trip.
    if (nextTab !== "day" && tab !== "day" && nextDate === date) {
      setTab(nextTab);
      return;
    }
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

      // Both tabs lean on what the app already knows: the day on what was
      // logged, the week on what is due.
      if (nextPeriod === "week") {
        const w = await apiFetch<{ week: WeekSummary }>(
          `/api/planner/summary?period=week&date=${nextDate}`
        );
        setWeek(w.week);
        setSummary(null);
        setTeamLines({});
      } else if (nextPeriod === "day") {
        setWeek(null);
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
      }

      setTab(nextTab);
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
            ["week-plan", "Weekly plan"],
            ["week-summary", "Weekly summary"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => void load(t, date)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
              tab === t
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
          onClick={() => void load(tab, shiftPeriod(period, date, -1))}
          aria-label="Previous"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          ←
        </button>
        <span className="min-w-[9rem] text-center text-sm font-semibold text-slate-800">
          {loading ? "…" : label}
        </span>
        <button
          onClick={() => void load(tab, shiftPeriod(period, date, 1))}
          aria-label="Next"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          →
        </button>

        <input
          type="date"
          value={date}
          aria-label="Jump to a date"
          onChange={(e) => e.target.value && void load(tab, e.target.value)}
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

      {tab !== "day" && week && (
        <WeekSummaryPanel
          summary={week}
          show={tab === "week-plan" ? "upcoming" : "held"}
          planned={pointsOf(plan).map((l) => l.toLowerCase())}
          onUseAsPlan={(titles) => {
            // Added to the box, not written to the database: it is a starting
            // point, and they still decide what the week is for — and press
            // Save. Lines already there are left alone, so pressing it twice
            // does not double the list.
            const existing = plan
              .split(/\r?\n/)
              .map((l) => l.trim().toLowerCase())
              .filter(Boolean);
            const fresh = titles.filter((t) => !existing.includes(t.trim().toLowerCase()));
            if (!fresh.length) {
              toast("They are all in your plan already");
              return;
            }
            setPlan((current) =>
              current.trim()
                ? `${current.replace(/\s+$/, "")}\n${fresh.join("\n")}`
                : fresh.join("\n")
            );
            setDirty(true);
            setPlanSeed((n) => n + 1);
            toast(
              fresh.length === 1
                ? "Added — press Save to keep it"
                : `${fresh.length} added — press Save to keep them`
            );
          }}
        />
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">
          {tab === "day"
            ? "In my own words"
            : tab === "week-plan"
              ? "What the week is really for"
              : "How the week went, in my own words"}
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          {savedAt
            ? `Last saved ${String(savedAt).replace("T", " ").slice(0, 16)}`
            : "Nothing written yet."}
        </p>

        {tab !== "week-summary" && (
          <PointsInput
            // Re-seeded when the period or the day changes: the rows are the
            // editing state, and this is a different entry.
            key={`plan-${tab}-${date}-${planSeed}`}
            id="planner-plan"
            label="What I mean to do"
            required={false}
            hint={
              period === "day"
                ? "Finish the dealer CSV export"
                : "Ship the dealer export"
            }
            help={
              <>
                One thing per line. <strong>Enter</strong> starts the next,{" "}
                <strong>✕</strong> removes one.
              </>
            }
            addLabel="+ Add a line"
            value={plan}
            onChange={(v) => {
              setPlan(v);
              setDirty(true);
            }}
          />
        )}

        {tab !== "week-plan" && (
          <>
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
          </>
        )}

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
            {tab === "week-plan"
              ? "How the week went is on the next tab — saving here keeps both."
              : tab === "week-summary"
                ? "The plan is on the previous tab — saving here keeps both."
                : "Clearing both boxes and saving removes the entry."}
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
