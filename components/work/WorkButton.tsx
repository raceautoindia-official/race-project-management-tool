"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { elapsedSeconds, formatClock, isRunningOn, pauseTimer, startTimer, useWorkTimer } from "./work-timer-store";

/**
 * ▶ Start / ▶ Resume / ⏸ Pause for one task or subtask. Starting runs the
 * work timer (and moves a To-do item to In progress); you must be clocked in
 * on the Attendance app. Shown only for items open for work. While another
 * item's timer runs it reads "Switch to this": one press pauses that one and
 * starts this.
 */
export default function WorkButton({
  taskId,
  subtaskId,
  status,
  title,
  size = "sm",
  compact = false,
  onChanged,
}: {
  taskId?: number;
  subtaskId?: number | null;
  status: string;
  title: string;
  size?: "sm" | "md";
  /** Icon only (the name is still read out), for tight rows. */
  compact?: boolean;
  onChanged?: () => void;
}) {
  const timer = useWorkTimer();
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const running = isRunningOn(timer, taskId, subtaskId);
  const other = !running ? timer?.running ?? null : null;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (status !== "todo" && status !== "in_progress") return null;

  async function run() {
    setBusy(true);
    try {
      if (running) {
        await pauseTimer();
        toast(`Paused “${title}”`);
      } else {
        await startTimer(subtaskId ? { subtaskId } : { taskId });
        toast(
          other
            ? `Paused “${other.subtaskTitle ?? other.taskTitle}” · timer running on “${title}”`
            : `Timer running on “${title}”`
        );
      }
      onChanged?.();
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work — please try again", "error");
    } finally {
      setBusy(false);
    }
  }

  const notIn = timer && !timer.attendanceUnavailable && timer.clock && !timer.clock.clockedIn;
  const pad = size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";
  return (
    <button
      type="button"
      disabled={busy}
      onClick={run}
      title={
        notIn && !running
          ? "Clock in on the Attendance app to start work"
          : compact
            ? running
              ? "Pause the timer"
              : other
                ? `Switch to this — pauses “${other.subtaskTitle ?? other.taskTitle}”`
                : status === "todo"
                ? "Start — runs the work timer"
                : "Resume — runs the work timer"
            : undefined
      }
      aria-label={running ? `Pause “${title}”` : `${other ? "Switch to" : status === "todo" ? "Start" : "Resume"} “${title}”`}
      className={`inline-flex items-center gap-1.5 rounded-lg border font-semibold disabled:opacity-50 ${pad} ${
        running
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {running ? (
        <>
          <span className="figure">⏸ {formatClock(elapsedSeconds(timer!, timer!.running!.startedAt))}</span>
        </>
      ) : compact ? (
        <span aria-hidden>▶</span>
      ) : other ? (
        "▶ Switch to this"
      ) : status === "todo" ? (
        "▶ Start"
      ) : (
        "▶ Resume"
      )}
    </button>
  );
}
