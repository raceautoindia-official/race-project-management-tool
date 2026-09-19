import type {
  TaskStatus,
  TaskPriority,
  ProjectStatus,
  RequestStatus,
  Role,
  WorkType,
} from "@/lib/types";
import { TASK_STATUS_LABELS } from "@/lib/types";
import { WORK_TYPE_LABELS } from "@/lib/workflow";

export function Badge({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  review: "bg-amber-100 text-amber-800",
  done: "bg-green-100 text-green-700",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge className={STATUS_STYLES[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-sky-100 text-sky-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <Badge className={PRIORITY_STYLES[priority]}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
}

const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  archived: "bg-slate-200 text-slate-600",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge className={PROJECT_STATUS_STYLES[status]}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

const WORK_TYPE_STYLES: Record<WorkType, string> = {
  correction: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
  feature: "bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200",
  general: "bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200",
};

export function WorkTypeBadge({ type }: { type: WorkType | undefined }) {
  const t = type ?? "general";
  return <Badge className={WORK_TYPE_STYLES[t]}>{WORK_TYPE_LABELS[t]}</Badge>;
}

const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export function RequestStatusBadge({
  status,
  pendingLabel = "Pending approval",
}: {
  status: RequestStatus;
  pendingLabel?: string;
}) {
  const label =
    status === "pending" ? pendingLabel : status === "approved" ? "Approved" : "Rejected";
  return <Badge className={REQUEST_STATUS_STYLES[status]}>{label}</Badge>;
}

/** Shown on signed-off tasks and completed projects. */
export function ReadOnlyBadge({ label = "Signed off" }: { label?: string }) {
  return (
    <Badge className="bg-emerald-100 text-emerald-800">
      <span aria-hidden="true" className="mr-1">🔒</span>
      {label}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: Role | "lead" }) {
  const styles =
    role === "admin"
      ? "bg-purple-100 text-purple-700"
      : role === "lead"
        ? "bg-indigo-100 text-indigo-700"
        : "bg-slate-100 text-slate-600";
  return <Badge className={styles}>{role}</Badge>;
}
