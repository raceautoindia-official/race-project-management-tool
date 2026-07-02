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

export const STATUS_CHART_COLORS: Record<TaskStatus, string> = {
  todo: "#94a3b8",
  in_progress: "#3b82f6",
  review: "#f59e0b",
  done: "#22c55e",
};

export function humanizeAction(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
