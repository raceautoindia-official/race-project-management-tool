import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";
import type { TaskStatus } from "./types";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? parseISO(value) : value;
  return isValid(d) ? d : null;
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "MMM d, yyyy") : "—";
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "MMM d, yyyy h:mm a") : "—";
}

export function formatRelative(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? formatDistanceToNow(d, { addSuffix: true }) : "—";
}

export function isOverdue(
  due: string | null | undefined,
  status: TaskStatus
): boolean {
  const d = toDate(due);
  if (!d || status === "done") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

// Validated with the dataviz palette checker (light surface #ffffff):
// CVD-safe (worst adjacent ΔE 16.2 ≥ 12) and all ≥3:1 contrast. `todo` is an
// intentional neutral for the not-started state; identity is always reinforced
// by the legend + counts, never colour alone.
export const STATUS_CHART_COLORS: Record<TaskStatus, string> = {
  todo: "#64748b", // slate-500 (neutral baseline)
  in_progress: "#2563eb", // blue-600
  review: "#d97706", // amber-600
  done: "#16a34a", // green-600
};

export function humanizeAction(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
