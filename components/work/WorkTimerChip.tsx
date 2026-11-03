"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import {
  elapsedSeconds,
  formatClock,
  formatMins,
  pauseTimer,
  refreshTimer,
  startTimer,
  useWorkTimer,
} from "./work-timer-store";

const POLL_MS = 60_000;

function istTime(utc: string | null): string {
  if (!utc) return "";
  return new Date(utc.replace(" ", "T") + "Z").toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  });
}

function link(projectId: number, taskId: number, subtaskId: number | null) {
  return `/projects/${projectId}?task=${taskId}${subtaskId ? `&subtask=${subtaskId}` : ""}`;
}

/**
 * The header's work timer: what you're working on and for how long, or
 * whether you're clocked in on Attendance at all. Opens a small panel with
 * Pause / Resume and today's clocked-in, on-task and idle time.
 */
export default function WorkTimerChip() {
  const timer = useWorkTimer();
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The browser clock, ticking each second while a timer runs (once a minute otherwise).
  const [nowMs, setNowMs] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refreshTimer();
    const poll = setInterval(() => void refreshTimer(), POLL_MS);
    const onFocus = () => void refreshTimer();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), timer?.running ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [timer?.running]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!timer) return null;
  const { running, clock, resume } = timer;
  const clockedIn = Boolean(clock?.clockedIn);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast(done);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work — please try again", "error");
    } finally {
      setBusy(false);
    }
  }

  // Today: tracked minutes were read at `now`; add the running stretch since.
  const liveTracked = running
    ? timer.trackedMinutes + Math.max(0, (nowMs - timer.readAt) / 60_000)
    : timer.trackedMinutes;
  const liveClocked = clockedIn ? (clock?.minutes ?? 0) + Math.max(0, (nowMs - timer.readAt) / 60_000) : clock?.minutes ?? 0;
  const idle = Math.max(0, liveClocked - liveTracked);

  const label = running
    ? running.subtaskTitle ?? running.taskTitle
    : timer.attendanceUnavailable
      ? "Attendance offline"
      : clockedIn
        ? "No timer running"
        : "Not clocked in";
  const tone = running
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : clockedIn
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex max-w-[16rem] items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}
      >
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${running ? "animate-pulse bg-emerald-500" : clockedIn ? "bg-amber-500" : "bg-slate-400"}`}
        />
        {running && <span className="figure">{formatClock(elapsedSeconds(timer, running.startedAt))}</span>}
        <span className="hidden truncate sm:inline">{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Work timer"
          className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-lg"
        >
          {running ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Working on</p>
              <Link
                href={link(running.projectId, running.taskId, running.subtaskId)}
                onClick={() => setOpen(false)}
                className="block font-semibold text-slate-900 hover:underline"
              >
                {running.subtaskTitle ?? running.taskTitle}
              </Link>
              <p className="text-xs text-slate-500">
                {running.subtaskTitle ? `${running.taskTitle} · ` : ""}
                {running.projectName} · since {istTime(running.startedAt)}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => act(pauseTimer, "Timer paused")}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                ⏸ Pause
              </button>
            </div>
          ) : timer.attendanceUnavailable ? (
            <p className="text-slate-600">
              PM can’t reach the Attendance app right now, so it can’t check that you’re clocked in.
              Timers can’t start until it’s back.
            </p>
          ) : !clockedIn ? (
            <p className="text-slate-600">
              You’re not clocked in on the Attendance app. Clock in there to start work — timers
              stop on their own when you clock out.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-slate-700">
                You’re clocked in since {istTime(clock?.since ?? null)}, but no task timer is running.
              </p>
              {resume ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => startTimer(resume.subtaskId ? { subtaskId: resume.subtaskId } : { taskId: resume.taskId }),
                      "Timer running again"
                    )
                  }
                  className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-left font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  ▶ Resume “{resume.subtaskTitle ?? resume.taskTitle}”
                  {resume.endReason === "clocked_out" && (
                    <span className="block text-xs font-normal text-indigo-100">
                      Paused at {istTime(resume.endedAt)} when you clocked out
                    </span>
                  )}
                </button>
              ) : (
                <Link href="/dashboard" onClick={() => setOpen(false)} className="text-indigo-700 hover:underline">
                  Pick something from My Work →
                </Link>
              )}
            </div>
          )}

          {(clock?.firstIn || timer.trackedMinutes > 0) && (
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
              <div>
                <dt className="text-[11px] text-slate-500">Clocked in</dt>
                <dd className="figure font-semibold text-slate-900">{formatMins(liveClocked)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">On tasks</dt>
                <dd className="figure font-semibold text-emerald-700">{formatMins(liveTracked)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">No timer</dt>
                <dd className="figure font-semibold text-amber-700">{formatMins(idle)}</dd>
              </div>
            </dl>
          )}
          <Link
            href="/work-hours"
            onClick={() => setOpen(false)}
            className="mt-3 block text-xs font-semibold text-indigo-700 hover:underline"
          >
            My time today →
          </Link>
        </div>
      )}
    </div>
  );
}
