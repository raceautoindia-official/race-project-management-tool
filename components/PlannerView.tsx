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
  isWorkDay,
  rangeBack,
  shiftPeriod,
  type PlannerPeriod,
} from "@/lib/planner";
import { formatIst } from "@/lib/tz";

export interface PlannerEntry {
  entry_date: string;
  period: PlannerPeriod;
  plan: string | null;
  progress: string | null;
  updated_at: string;
  /** When it was handed in, and by whom: the person, or the app at day's end. */
  submitted_at?: string | null;
  submission?: "manual" | "auto" | null;
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
  teamOnly = false,
  initialLocked = false,
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
  /** An admin reads everyone's and writes none of their own. */
  teamOnly?: boolean;
  /** The day (or week) shown first is over, so it can only be read. */
  initialLocked?: boolean;
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
  const [submission, setSubmission] = useState<PlannerEntry["submission"]>(initialEntry?.submission ?? null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(initialEntry?.submitted_at ?? null);
  const [locked, setLocked] = useState(initialLocked);
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
      const mine = await apiFetch<{ entry: PlannerEntry | null; locked: boolean }>(
        `/api/planner?period=${nextPeriod}&date=${nextDate}`
      );
      setPlan(mine.entry?.plan ?? "");
      setProgress(mine.entry?.progress ?? "");
      setSavedAt(mine.entry?.updated_at ?? null);
      setSubmission(mine.entry?.submission ?? null);
      setSubmittedAt(mine.entry?.submitted_at ?? null);
      setLocked(Boolean(mine.locked));
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

  async function save(quiet = false): Promise<PlannerEntry | null | undefined> {
    setBusy(true);
    try {
      const res = await apiFetch<{ entry: PlannerEntry | null }>("/api/planner", {
        method: "PUT",
        body: JSON.stringify({ period, date, plan, progress }),
      });
      setSavedAt(res.entry?.updated_at ?? null);
      setSubmission(res.entry?.submission ?? null);
      setSubmittedAt(res.entry?.submitted_at ?? null);
      setDirty(false);
      if (!quiet) toast(res.entry ? "Saved" : "Entry removed");
      if (canSeeOthers) {
        const others = await apiFetch<{ entries: PlannerEntry[] }>(
          `/api/planner?scope=team&period=${period}&date=${date}`
        );
        setTeam(others.entries);
      }
      return res.entry;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  /** Save what is in the boxes, then hand it in. */
  async function submit() {
    const saved = await save(true);
    if (saved === undefined) return;
    if (!saved) {
      toast("Write something first — an empty day is submitted for you at the end of the day", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ entry: PlannerEntry }>("/api/planner/submit", {
        method: "POST",
        body: JSON.stringify({ period, date }),
      });
      setSubmission(res.entry.submission ?? "manual");
      setSubmittedAt(res.entry.submitted_at ?? null);
      toast(period === "day" ? "Daily update submitted" : "Weekly update submitted");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not submit", "error");
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
      {/* Three views of the same week, so they sit in one control rather
          than reading as three separate links. */}
      <div
        role="tablist"
        aria-label="Work updates"
        className="mb-4 inline-flex rounded-xl bg-slate-100 p-1"
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
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === t
                ? "bg-white text-amber-800 shadow-sm ring-1 ring-amber-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Back, the date, forward: one object, because it is one decision. */}
        <div className="inline-flex items-stretch overflow-hidden rounded-xl bg-white ring-1 ring-slate-300">
          <button
            onClick={() => void load(tab, shiftPeriod(period, date, -1))}
            aria-label="Previous"
            className="px-3 text-slate-600 transition hover:bg-amber-50 hover:text-amber-800"
          >
            ←
          </button>
          <span className="min-w-[9.5rem] border-x border-slate-200 px-3 py-2 text-center text-sm font-semibold text-slate-900">
            {loading ? "…" : label}
          </span>
          <button
            onClick={() => void load(tab, shiftPeriod(period, date, 1))}
            aria-label="Next"
            className="px-3 text-slate-600 transition hover:bg-amber-50 hover:text-amber-800"
          >
            →
          </button>
        </div>

        <input
          type="date"
          value={date}
          aria-label="Jump to a date"
          onChange={(e) => e.target.value && void load(tab, e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />

        {/* Mine and everyone's are different acts, so they are not the same
            colour. */}
        {!teamOnly && (
          <a
            href={exportHref}
            className="ml-auto rounded-xl px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-300 transition hover:bg-amber-50"
          >
            ⤓ Download mine
          </a>
        )}
        {canSeeOthers && (
          <a
            href={`/api/planner/export?scope=team&period=${period}&date=${date}`}
            className={`${teamOnly ? "ml-auto " : ""}rounded-xl px-3 py-2 text-sm font-medium text-sky-800 ring-1 ring-sky-300 transition hover:bg-sky-50`}
          >
            ⤓ Download {teamOnly ? "everyone" : "the team"}&rsquo;s
          </a>
        )}
      </div>

      {!teamOnly && period === "day" && summary && (
        <div className="mb-4">
          <DailySummaryPanel summary={summary} />
        </div>
      )}

      {!teamOnly && tab !== "day" && week && (
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

      {/* The other half of the page: the part only a person can write. */}
      {!teamOnly && (
      <section className="mt-4 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">
            {tab === "day"
              ? "In my own words"
              : tab === "week-plan"
                ? "What the week is really for"
                : "How the week went, in my own words"}
          </h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              submission === "manual"
                ? "bg-emerald-100 text-emerald-800"
                : submission === "auto"
                  ? "bg-sky-100 text-sky-800"
                  : savedAt
                    ? "bg-amber-100 text-amber-900"
                    : "bg-slate-200 text-slate-700"
            }`}
          >
            {submission === "manual"
              ? `Submitted${submittedAt ? ` ${formatIst(submittedAt)}` : ""}`
              : submission === "auto"
                ? "Submitted automatically"
                : savedAt
                  ? `Saved ${String(savedAt).replace("T", " ").slice(0, 16)} · not submitted yet`
                  : "Nothing written yet"}
          </span>
          {locked && (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-white">
              🔒 Locked
            </span>
          )}
        </div>

        <div className="px-5 py-4">
        {locked ? (
          // The day is over: what was handed in is the record.
          <div className="space-y-3">
            {tab !== "week-summary" && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What I meant to do</p>
                {pointsOf(plan).length ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                    {pointsOf(plan).map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">—</p>
                )}
              </div>
            )}
            {tab !== "week-plan" && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">How it went</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{progress || "—"}</p>
              </div>
            )}
            <p className="text-xs text-slate-500">
              {period === "day"
                ? "Updates lock at midnight. This day is over, so it can only be read."
                : "Weekly updates lock at midnight on Saturday. This week is over, so it can only be read."}
            </p>
          </div>
        ) : (
          <>
        {period === "day" && !isWorkDay(date) && (
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
            Sunday — no update is due today. You can still write one.
          </p>
        )}
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

        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void submit()}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {submission === "manual" ? "Submit changes" : "Submit update"}
            </button>
            <button
              onClick={() => void save()}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {dirty && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
                Not saved yet
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {tab === "week-plan"
              ? "How the week went is on the next tab — saving here keeps both."
              : tab === "week-summary"
                ? "The plan is on the previous tab — saving here keeps both."
                : "Clearing both boxes and saving removes the entry."}{" "}
            {period === "day"
              ? "Submit it before the end of the day — anything not submitted is handed in for you, and the day locks at midnight."
              : "Submit it by Saturday — anything not submitted is handed in for you, and the week locks at midnight on Saturday."}
          </p>
        </div>
          </>
        )}
        </div>
      </section>
      )}

      {canSeeOthers && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            {teamOnly ? "Everyone" : "The team"} — {label}
          </h2>
          {team.filter((t) => t.user_id !== currentUserId).length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              Nobody {teamOnly ? "" : "else "}has written anything for this {period}.
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
