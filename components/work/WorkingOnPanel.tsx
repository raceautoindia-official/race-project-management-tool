"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import type { WorkItem } from "@/lib/my-work";
import type { ItemTime } from "@/lib/time-data";
import DoActions from "./DoActions";
import { ItemContext, itemHref, utcAgo } from "./items";
import { elapsedSeconds, formatClock, formatMins, isRunningOn, liveTrackedMinutes, startTimer, useWorkTimer, type TimerState } from "./work-timer-store";

/**
 * My Work › Working on: everything I have started and not yet sent for
 * review, with the one whose timer is running at the top. One timer runs at
 * a time, so pressing ▶ on another item pauses the running one and switches
 * (no need to pause first). Each item shows today's time and its total, why
 * it was last paused, and a nudge when it hasn't been touched for days.
 * Below, anything not started yet can be started from a short picker.
 */

export interface WorkingOnItem extends WorkItem {
  time: ItemTime | null;
}

const STALE_DAYS = 3;

const PAUSE_REASON: Record<string, string> = {
  paused: "you paused it",
  switched: "you switched to other work",
  clocked_out: "you clocked out on Attendance",
};

const toMs = (utc: string) => Date.parse(utc.replace(" ", "T") + "Z");

function keyOf(i: Pick<WorkItem, "kind" | "id">) {
  return `${i.kind}-${i.id}`;
}

function matches(timer: TimerState | null, i: WorkItem) {
  return i.kind === "subtask" ? isRunningOn(timer, i.task_id, i.id) : isRunningOn(timer, i.id, null);
}

export default function WorkingOnPanel({
  items,
  notStarted,
  todayStartUtc,
}: {
  items: WorkingOnItem[];
  notStarted: WorkItem[];
  /** Midnight IST today as a UTC "YYYY-MM-DD HH:MM:SS" stamp. */
  todayStartUtc: string;
}) {
  const timer = useWorkTimer();
  const [, tick] = useState(0);
  const running = timer?.running ?? null;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // The running item, even when it isn't on my list (a task I own but am not assigned).
  const list: WorkingOnItem[] = [...items];
  if (running && !list.some((i) => matches(timer, i))) {
    list.unshift({
      kind: running.subtaskId ? "subtask" : "task",
      id: running.subtaskId ?? running.taskId,
      task_id: running.taskId,
      title: running.subtaskTitle ?? running.taskTitle,
      task_title: running.taskTitle,
      project_id: running.projectId,
      project_name: running.projectName,
      status: "in_progress",
      start_date: null,
      due_date: null,
      person_id: null,
      person_name: null,
      submitted_at: null,
      changes_requested: null,
      project_owner_name: null,
      time: null,
    });
  }

  // Active first, then the most recently worked on, then never timed.
  const lastAt = (i: WorkingOnItem) => (i.time?.lastEndedAt ?? i.time?.lastStartedAt ?? "");
  list.sort((a, b) => Number(matches(timer, b)) - Number(matches(timer, a)) || lastAt(b).localeCompare(lastAt(a)));

  const clock = timer?.clock ?? null;
  const notIn = timer && !timer.attendanceUnavailable && clock && !clock.clockedIn;
  const pausedCount = list.filter((i) => !matches(timer, i)).length;

  return (
    <section aria-labelledby="working-on" className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
        <h2 id="working-on" className="text-base font-semibold text-slate-900">
          Working on
        </h2>
        <span className="text-xs text-slate-500">
          {running ? "1 active" : "Nothing active"}
          {pausedCount > 0 && ` · ${pausedCount} paused`}
        </span>
        <span className="ml-auto text-xs text-slate-500">
          {timer?.attendanceUnavailable
            ? "Attendance can't be reached"
            : clock?.clockedIn
              ? `Clocked in · ${formatMins(timer ? liveTrackedMinutes(timer) : 0)} on tasks today`
              : timer
                ? "Not clocked in"
                : ""}
          <Link href="/work-hours" className="ml-2 font-medium text-indigo-600 hover:underline">
            Today’s hours →
          </Link>
        </span>
      </div>

      {notIn && (
        <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          You’re not clocked in on the Attendance app, so no timer can run. Clock in there, then press ▶ on what you’re picking up.
        </p>
      )}

      {list.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">
          You haven’t started anything yet. Pick something below — its timer runs while you’re clocked in.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((i) => (
            <Row key={keyOf(i)} item={i} timer={timer} active={matches(timer, i)} todayStartUtc={todayStartUtc} />
          ))}
        </ul>
      )}

      {notStarted.length > 0 && <StartPicker items={notStarted} switching={running ? running.subtaskTitle ?? running.taskTitle : null} />}
    </section>
  );
}

function Row({ item, timer, active, todayStartUtc }: { item: WorkingOnItem; timer: TimerState | null; active: boolean; todayStartUtc: string }) {
  const t = item.time;
  let runSecs = 0;
  let runTodaySecs = 0;
  if (active && timer?.running) {
    runSecs = elapsedSeconds(timer, timer.running.startedAt);
    runTodaySecs = Math.min(runSecs, elapsedSeconds(timer, todayStartUtc));
  }
  const today = (t?.todayMinutes ?? 0) + runTodaySecs / 60;
  const total = (t?.totalMinutes ?? 0) + runSecs / 60;

  const lastTouched = t?.lastEndedAt ?? t?.lastStartedAt ?? null;
  const serverNow = timer ? Date.parse(timer.now) : null;
  const staleDays = !active && lastTouched && serverNow ? Math.floor((serverNow - toMs(lastTouched)) / 86_400_000) : 0;

  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${active ? "bg-emerald-50/60" : ""}`}>
      <span
        className={`inline-flex w-20 shrink-0 items-center gap-1.5 text-xs font-semibold ${
          active ? "text-emerald-700" : t ? "text-amber-700" : "text-slate-500"
        }`}
      >
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${active ? "animate-pulse bg-emerald-500" : t ? "bg-amber-400" : "bg-slate-300"}`}
        />
        {active ? "Active" : t ? "Paused" : "Not timed"}
      </span>

      <div className="min-w-0 flex-1 basis-56">
        <Link href={itemHref(item)} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">
          {item.title}
        </Link>
        <ItemContext item={item} />
        <p className="mt-0.5 text-xs text-slate-500">
          {active && timer?.running ? (
            <span className="figure font-medium text-emerald-700">Running {formatClock(runSecs)}</span>
          ) : t?.lastEndedAt ? (
            <>
              Paused {utcAgo(t.lastEndedAt)}
              {t.lastEndReason && PAUSE_REASON[t.lastEndReason] ? ` · ${PAUSE_REASON[t.lastEndReason]}` : ""}
            </>
          ) : (
            "Marked in progress, but no time on the timer yet"
          )}
          {staleDays >= STALE_DAYS && (
            <span className="ml-1 font-medium text-orange-600">· not worked on for {staleDays} days</span>
          )}
        </p>
      </div>

      <span className="figure flex w-full items-baseline gap-2 text-xs text-slate-500 sm:block sm:w-28 sm:shrink-0 sm:text-right">
        <span className="text-sm font-semibold text-slate-900 sm:block">{formatMins(today)} today</span>
        {formatMins(total)} in all
      </span>

      <DoActions kind={item.kind} id={item.id} status={item.status} title={item.title} />
    </li>
  );
}

/** Start something not started yet, switching from what's running. */
function StartPicker({ items, switching }: { items: WorkItem[]; switching: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    const item = items.find((i) => keyOf(i) === choice);
    if (!item) return;
    setBusy(true);
    try {
      await startTimer(item.kind === "subtask" ? { subtaskId: item.id } : { taskId: item.id });
      toast(switching ? `Paused “${switching}” · timer running on “${item.title}”` : `Timer running on “${item.title}”`);
      setChoice("");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work — please try again", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
      <label htmlFor="start-new" className="text-xs font-medium text-slate-600">
        Start something new
      </label>
      <select
        id="start-new"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="min-w-0 flex-1 basis-56 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
      >
        <option value="">Choose from your to-do ({items.length} not started)</option>
        {items.map((i) => (
          <option key={keyOf(i)} value={keyOf(i)}>
            {i.title} — {i.kind === "subtask" ? `${i.task_title} · ` : ""}
            {i.project_name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!choice || busy}
        onClick={start}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {switching ? "▶ Switch to it" : "▶ Start"}
      </button>
    </div>
  );
}
