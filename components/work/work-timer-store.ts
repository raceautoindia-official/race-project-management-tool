"use client";

import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * The signed-in person's work timer and Attendance clock, shared by the
 * header chip and every Start / Pause button on the page, so they agree.
 * The chip polls; buttons call start / pause, which update everyone.
 */

export interface ClockInfo {
  clockedIn: boolean;
  since: string | null;
  firstIn: string | null;
  lastOut: string | null;
  minutes: number;
  status: string | null;
}

export interface RunningInfo {
  sessionId: number;
  taskId: number;
  subtaskId: number | null;
  taskTitle: string;
  subtaskTitle: string | null;
  projectId: number;
  projectName: string;
  startedAt: string;
}

export interface ResumeInfo {
  taskId: number;
  subtaskId: number | null;
  projectId: number;
  taskTitle: string;
  subtaskTitle: string | null;
  endReason: string;
  endedAt: string;
}

export interface TimerState {
  /** Server time when this was read; elapsed times count from it. */
  now: string;
  clock: ClockInfo | null;
  attendanceUnavailable: boolean;
  running: RunningInfo | null;
  resume: ResumeInfo | null;
  trackedMinutes: number;
  /** Browser time when this was read. */
  readAt: number;
}

let state: TimerState | null = null;
const listeners = new Set<() => void>();

function set(next: Omit<TimerState, "readAt">) {
  state = { ...next, readAt: Date.now() };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useWorkTimer(): TimerState | null {
  return useSyncExternalStore(subscribe, () => state, () => null);
}

export async function refreshTimer(): Promise<void> {
  try {
    set(await apiFetch<Omit<TimerState, "readAt">>("/api/work/timer"));
  } catch {
    // Signed out or offline: keep what we had.
  }
}

/** Start (or resume) work. Throws the server's reason, e.g. not clocked in. */
export async function startTimer(target: { taskId?: number; subtaskId?: number | null }): Promise<TimerState> {
  set(
    await apiFetch<Omit<TimerState, "readAt">>("/api/work/timer", {
      method: "POST",
      body: JSON.stringify({ action: "start", ...target }),
    })
  );
  return state!;
}

export async function pauseTimer(): Promise<TimerState> {
  set(await apiFetch<Omit<TimerState, "readAt">>("/api/work/timer", { method: "POST", body: JSON.stringify({ action: "pause" }) }));
  return state!;
}

/** Seconds a stretch has run, as of now in the browser. */
export function elapsedSeconds(s: TimerState, startedAt: string): number {
  const started = new Date(startedAt.replace(" ", "T") + "Z").getTime();
  const serverNow = new Date(s.now).getTime() + (Date.now() - s.readAt);
  return Math.max(0, Math.floor((serverNow - started) / 1000));
}

/** Today's minutes on tasks, counting the running stretch up to now. */
export function liveTrackedMinutes(s: TimerState): number {
  return s.running ? s.trackedMinutes + Math.max(0, (Date.now() - s.readAt) / 60_000) : s.trackedMinutes;
}

export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function formatMins(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`;
}

/** Does the running timer belong to this task / subtask? */
export function isRunningOn(s: TimerState | null, taskId?: number, subtaskId?: number | null): boolean {
  const r = s?.running;
  if (!r) return false;
  if (subtaskId) return r.subtaskId === subtaskId;
  return r.taskId === taskId && r.subtaskId === null;
}
