// The single source of truth for weights, progress, review routing, health and
// permissions in the preview. This is the logic the backend will later own
// (lib/progress-engine.ts + lib/permissions.ts in docs/REDESIGN_PLAN.md).

import { differenceInCalendarDays, parseISO } from "date-fns";
import type {
  PreviewState,
  Project,
  WorkItem,
  Person,
} from "./types";

// ── Lookups ────────────────────────────────────────────────────────────────

export function personById(s: PreviewState, id: string | null | undefined): Person | null {
  if (!id) return null;
  return s.people.find((p) => p.id === id) ?? s.platformAdmins.find((p) => p.id === id) ?? null;
}

export function projectById(s: PreviewState, id: string): Project | null {
  return s.projects.find((p) => p.id === id) ?? null;
}

export function itemById(s: PreviewState, id: string): WorkItem | null {
  return s.items.find((i) => i.id === id) ?? null;
}

export function tasksOf(s: PreviewState, projectId: string): WorkItem[] {
  return s.items
    .filter((i) => i.projectId === projectId && i.parentId === null)
    .sort((a, b) => a.position - b.position);
}

export function subtasksOf(s: PreviewState, taskId: string): WorkItem[] {
  return s.items
    .filter((i) => i.parentId === taskId)
    .sort((a, b) => a.position - b.position);
}

export function siblingsOf(s: PreviewState, item: WorkItem): WorkItem[] {
  return item.parentId
    ? subtasksOf(s, item.parentId)
    : tasksOf(s, item.projectId);
}

// ── Weights ────────────────────────────────────────────────────────────────

/**
 * Effective weights for a set of siblings. Manual items keep their value; auto
 * items share what is left equally; cancelled items get 0.
 */
export function effectiveWeights(siblings: WorkItem[]): Map<string, number> {
  const live = siblings.filter((i) => i.status !== "cancelled");
  const manual = live.filter((i) => i.weightMode === "manual");
  const auto = live.filter((i) => i.weightMode === "auto");
  const manualSum = manual.reduce((sum, i) => sum + i.weight, 0);
  const autoShare = auto.length ? Math.max(0, 100 - manualSum) / auto.length : 0;
  const out = new Map<string, number>();
  for (const i of siblings) {
    if (i.status === "cancelled") out.set(i.id, 0);
    else if (i.weightMode === "manual") out.set(i.id, i.weight);
    else out.set(i.id, autoShare);
  }
  return out;
}

export function weightOf(s: PreviewState, item: WorkItem): number {
  return effectiveWeights(siblingsOf(s, item)).get(item.id) ?? 0;
}

// ── Progress ───────────────────────────────────────────────────────────────

/** `approved` counts toward progress; `pending` is done but awaiting review. */
export interface Progress {
  approved: number; // 0–100
  pending: number; // 0–100
}

function leafProgress(item: WorkItem): Progress {
  if (item.status === "done") return { approved: 100, pending: 0 };
  if (item.status === "in_review") return { approved: 0, pending: 100 };
  return { approved: 0, pending: 0 };
}

function rollUp(children: WorkItem[], each: (i: WorkItem) => Progress): Progress {
  const weights = effectiveWeights(children);
  let total = 0;
  let approved = 0;
  let pending = 0;
  for (const c of children) {
    const w = weights.get(c.id) ?? 0;
    if (w <= 0) continue;
    const p = each(c);
    total += w;
    approved += w * p.approved;
    pending += w * p.pending;
  }
  if (total === 0) return { approved: 0, pending: 0 };
  return { approved: approved / total, pending: pending / total };
}

/**
 * A task's progress = weighted share of its subtasks that the task owner has
 * approved. A task with no subtasks is a leaf. A task approved by the project
 * owner is 100%.
 */
export function taskProgress(s: PreviewState, task: WorkItem): Progress {
  if (task.status === "done") return { approved: 100, pending: 0 };
  const subs = subtasksOf(s, task.id);
  if (subs.length === 0) return leafProgress(task);
  return rollUp(subs, leafProgress);
}

/**
 * Project progress. Default mode counts a task only once the project owner has
 * approved it (the client's requirement). "partial" mode lets approved subtasks
 * inside unfinished tasks count too — offered as an org setting.
 */
export function projectProgress(s: PreviewState, project: Project): Progress {
  const tasks = tasksOf(s, project.id);
  if (s.org.progressMode === "partial") {
    return rollUp(tasks, (t) => taskProgress(s, t));
  }
  return rollUp(tasks, leafProgress);
}

export function itemProgress(s: PreviewState, item: WorkItem): Progress {
  return item.parentId ? leafProgress(item) : taskProgress(s, item);
}

// ── Review routing ─────────────────────────────────────────────────────────

/** Who must approve this item: subtask → task owner; task → project owner. */
export function reviewerIdFor(s: PreviewState, item: WorkItem): string | null {
  if (item.parentId) return itemById(s, item.parentId)?.personId ?? null;
  return projectById(s, item.projectId)?.ownerId ?? null;
}

/** Items waiting for this person's review. */
export function reviewQueue(s: PreviewState, personId: string): WorkItem[] {
  return s.items.filter(
    (i) => i.status === "in_review" && reviewerIdFor(s, i) === personId
  );
}

// ── Dates & health ─────────────────────────────────────────────────────────

export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isOverdue(item: { dueDate: string | null; status: string }): boolean {
  if (!item.dueDate) return false;
  if (item.status === "done" || item.status === "cancelled") return false;
  return item.dueDate < todayISO();
}

export function daysUntil(date: string): number {
  return differenceInCalendarDays(parseISO(date), parseISO(todayISO()));
}

export type Health = "on_track" | "at_risk" | "off_track" | "not_started" | "done";

/**
 * Compare actual (approved) progress with the share of the schedule elapsed.
 * >10 points behind = at risk, >25 = off track.
 */
export function projectHealth(
  s: PreviewState,
  project: Project
): { health: Health; expected: number; actual: number } {
  const actual = projectProgress(s, project).approved;
  if (project.state === "closed" || actual >= 99.5)
    return { health: "done", expected: 100, actual };
  const total = differenceInCalendarDays(parseISO(project.dueDate), parseISO(project.startDate));
  const elapsed = differenceInCalendarDays(parseISO(todayISO()), parseISO(project.startDate));
  if (elapsed < 0) return { health: "not_started", expected: 0, actual };
  const expected = total <= 0 ? 100 : Math.min(100, (elapsed / total) * 100);
  const gap = expected - actual;
  const health: Health = gap > 25 ? "off_track" : gap > 10 ? "at_risk" : "on_track";
  return { health, expected, actual };
}

// ── Permissions ────────────────────────────────────────────────────────────

export type Action =
  | "project.edit"
  | "project.close"
  | "task.create"
  | "task.weights"
  | "task.edit"
  | "subtask.create"
  | "subtask.weights"
  | "item.work" // change status / submit / log time
  | "item.review"
  | "comment";

export function isProjectOwner(s: PreviewState, userId: string, projectId: string): boolean {
  const p = projectById(s, projectId);
  return !!p && p.ownerId === userId;
}

/**
 * Can `userId` perform `action`? `target` is the project or the item the
 * action applies to. Admins can do everything.
 */
export function can(
  s: PreviewState,
  userId: string,
  action: Action,
  target: { project: Project; item?: WorkItem | null }
): boolean {
  const me = personById(s, userId);
  if (!me) return false;
  if (me.isAdmin) return true;
  const { project, item } = target;
  const owner = project.ownerId === userId;
  const member = owner || project.memberIds.includes(userId);
  const task = item ? (item.parentId ? itemById(s, item.parentId) : item) : null;
  const taskOwner = !!task && task.personId === userId;

  switch (action) {
    case "project.edit":
    case "project.close":
    case "task.create":
    case "task.weights":
      return owner;
    case "task.edit":
    case "subtask.create":
    case "subtask.weights":
      return owner || taskOwner;
    case "item.work":
      return owner || taskOwner || (!!item && item.personId === userId);
    case "item.review":
      return !!item && reviewerIdFor(s, item) === userId;
    case "comment":
      return member;
  }
}

/** Deep link to an item: tasks open their page; subtasks open in the drawer. */
export function itemLink(s: PreviewState, id: string): string {
  const it = itemById(s, id);
  if (!it) return "/preview";
  const taskId = it.parentId ?? it.id;
  return `/preview/projects/${it.projectId}/tasks/${taskId}${it.parentId ? `?open=${it.id}` : ""}`;
}

// ── Hours & man-hours ──────────────────────────────────────────────────────
//
// Expected hours are planned up front (project budget → task estimate →
// subtask estimates). Actual man-hours are the sum of time-log entries. The
// metrics below compare the two so owners can see effort, not just progress.

function isLeafItem(s: PreviewState, item: WorkItem): boolean {
  return !!item.parentId || !s.items.some((x) => x.parentId === item.id);
}

/** The item plus its subtasks (for a task), or all items of a project. */
function scopeItems(s: PreviewState, scope: { project: Project } | { item: WorkItem }): WorkItem[] {
  if ("project" in scope) return s.items.filter((i) => i.projectId === scope.project.id);
  const it = scope.item;
  return it.parentId ? [it] : [it, ...s.items.filter((x) => x.parentId === it.id)];
}

/** Man-hours logged on an item (a task includes its subtasks). */
export function loggedHours(s: PreviewState, item: WorkItem): number {
  const ids = new Set(scopeItems(s, { item }).map((i) => i.id));
  return s.timeLogs.reduce((sum, l) => (ids.has(l.itemId) ? sum + l.hours : sum), 0);
}

/** Sum of the subtasks' expected hours (what the task owner has allocated). */
export function allocatedHours(s: PreviewState, task: WorkItem): number {
  return subtasksOf(s, task.id)
    .filter((x) => x.status !== "cancelled")
    .reduce((sum, x) => sum + (x.estimatedHours ?? 0), 0);
}

/** Expected hours for an item: its own estimate, else what its subtasks add up to. */
export function plannedHours(s: PreviewState, item: WorkItem): number {
  if (item.estimatedHours != null) return item.estimatedHours;
  return item.parentId ? 0 : allocatedHours(s, item);
}

export interface HoursSummary {
  planned: number; // expected hours (budget)
  allocated: number; // planned at the level below
  logged: number; // actual man-hours
  remaining: number; // planned − logged (never negative)
  usedPct: number; // logged ÷ planned
  earned: number; // expected hours of approved work
  doneActual: number; // man-hours spent on approved work
  efficiency: number | null; // earned ÷ doneActual (100% = on estimate)
  forecast: number; // expected total at completion at the current efficiency
  forecastVariancePct: number; // forecast vs planned
  people: { personId: string; hours: number }[];
}

export function hoursSummary(s: PreviewState, scope: { project: Project } | { item: WorkItem }): HoursSummary {
  const items = scopeItems(s, scope).filter((i) => i.status !== "cancelled");
  const ids = new Set(items.map((i) => i.id));
  const logs = s.timeLogs.filter((l) => ids.has(l.itemId));
  const logged = logs.reduce((sum, l) => sum + l.hours, 0);

  let planned: number;
  let allocated: number;
  if ("project" in scope) {
    allocated = tasksOf(s, scope.project.id)
      .filter((t) => t.status !== "cancelled")
      .reduce((sum, t) => sum + plannedHours(s, t), 0);
    planned = scope.project.expectedHours ?? allocated;
  } else {
    planned = plannedHours(s, scope.item);
    allocated = scope.item.parentId ? planned : allocatedHours(s, scope.item);
  }

  const leaves = items.filter((i) => isLeafItem(s, i));
  const done = leaves.filter((i) => i.status === "done");
  const earned = done.reduce((sum, i) => sum + (i.estimatedHours ?? 0), 0);
  const doneIds = new Set(done.map((i) => i.id));
  const doneActual = logs.filter((l) => doneIds.has(l.itemId)).reduce((sum, l) => sum + l.hours, 0);
  const efficiency = doneActual > 0 ? (earned / doneActual) * 100 : null;
  const remainingWork = Math.max(0, planned - earned);
  const forecast = logged + remainingWork * (efficiency ? 100 / efficiency : 1);

  const byPerson = new Map<string, number>();
  for (const l of logs) byPerson.set(l.personId, (byPerson.get(l.personId) ?? 0) + l.hours);

  return {
    planned,
    allocated,
    logged,
    remaining: Math.max(0, planned - logged),
    usedPct: planned > 0 ? (logged / planned) * 100 : 0,
    earned,
    doneActual,
    efficiency,
    forecast,
    forecastVariancePct: planned > 0 ? ((forecast - planned) / planned) * 100 : 0,
    people: [...byPerson.entries()].map(([personId, hours]) => ({ personId, hours })).sort((a, b) => b.hours - a.hours),
  };
}

/** Working days between two dates (inclusive) using the company's work week. */
export function workingDaysBetween(s: PreviewState, from: string, to: string): number {
  let n = 0;
  const d = parseISO(from);
  const end = parseISO(to);
  while (d <= end) {
    if (s.org.workingDays.includes(d.getDay())) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

/** Hours a person logged in a date range, and their capacity in it. */
export function personHours(s: PreviewState, personId: string, from: string, to: string): { logged: number; capacity: number; utilisation: number } {
  const logged = s.timeLogs
    .filter((l) => l.personId === personId && l.date >= from && l.date <= to)
    .reduce((sum, l) => sum + l.hours, 0);
  // Capacity only counts days up to today, so a half-finished week isn't
  // reported as half-utilised.
  const until = to < todayISO() ? to : todayISO();
  const capacity = until < from ? 0 : workingDaysBetween(s, from, until) * s.org.workingHoursPerDay;
  return { logged, capacity, utilisation: capacity > 0 ? (logged / capacity) * 100 : 0 };
}

/** Monday-start week containing `date` (yyyy-MM-dd strings). */
export function weekOf(date: string): { start: string; end: string; days: string[] } {
  const d = parseISO(date);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    const pad = (n: number) => String(n).padStart(2, "0");
    days.push(`${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`);
  }
  return { start: days[0], end: days[6], days };
}

export function hrs(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}h`;
}

// ── Formatting helpers ─────────────────────────────────────────────────────

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

export function weightLabel(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}%`;
}
