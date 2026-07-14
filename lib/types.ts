export type Role = "admin" | "member";
export type ProjectStatus = "active" | "completed" | "archived";
export type ProjectRole = "lead" | "member";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type ApprovalStatus = "none" | "pending" | "approved" | "rejected";

export const TASK_STATUSES: TaskStatus[] = [
  "todo",
  "in_progress",
  "review",
  "done",
];
export const TASK_PRIORITIES: TaskPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];
export const PROJECT_STATUSES: ProjectStatus[] = [
  "active",
  "completed",
  "archived",
];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

/** The minimal identity carried inside the signed session JWT. */
export interface SessionUser {
  userId: number;
  role: Role;
  name: string;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  owner_id: number | null;
  owner_name?: string | null;
  created_at: string;
  updated_at: string;
  member_count?: number;
  task_count?: number;
  done_count?: number;
  role_in_project?: ProjectRole;
}

export interface ProjectMember {
  id: number;
  project_id: number;
  user_id: number;
  role_in_project: ProjectRole;
  name: string;
  email: string;
}

export interface Task {
  id: number;
  project_id: number;
  project_name?: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  outstanding?: boolean;
  approval_status?: ApprovalStatus;
  approved_by?: number | null;
  approved_at?: string | null;
  completed_at?: string | null;
  is_additional?: boolean;
  parent_task_id?: number | null;
  priority: TaskPriority;
  estimated_hours: number | null;
  spent_hours: number;
  start_date?: string | null;
  assignee_id: number | null;
  assignee_name?: string | null;
  created_by: number | null;
  creator_name?: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  comment_count?: number;
  labels?: Label[];
  subtask_total?: number;
  subtask_done?: number;
}

export interface Label {
  id: number;
  project_id: number;
  name: string;
  color: string;
}

export interface Subtask {
  id: number;
  task_id: number;
  title: string;
  is_done: boolean;
  position: number;
}

export interface Comment {
  id: number;
  task_id: number;
  user_id: number;
  user_name?: string;
  body: string;
  edited_at?: string | null;
  created_at: string;
}

export interface Milestone {
  id: number;
  project_id: number;
  name: string;
  due_date: string | null;
  is_done: boolean;
  created_by?: number | null;
}

export interface Attachment {
  id: number;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
  uploaded_by: number | null;
  uploader_name?: string | null;
}

export interface ActivityItem {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface NotificationItem {
  id: number;
  user_id: number;
  type: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export type Recurrence = "none" | "daily" | "weekly" | "monthly";

export const REMINDER_CATEGORIES = [
  "payment",
  "renewal",
  "follow_up",
  "meeting",
  "general",
  "custom",
] as const;
export type ReminderCategory = (typeof REMINDER_CATEGORIES)[number];

export const REMINDER_CATEGORY_LABELS: Record<string, string> = {
  payment: "Payment",
  renewal: "Renewal",
  follow_up: "Follow-up",
  meeting: "Meeting",
  general: "General",
  custom: "Custom",
};

export interface Reminder {
  id: number;
  user_id: number;
  title: string;
  category: string;
  notes: string | null;
  scheduled_at: string;
  reminder_minutes: number;
  recurrence: Recurrence;
  notify_email: boolean;
  notify_push: boolean;
  is_done: boolean;
}

export interface Meeting {
  id: number;
  title: string;
  description: string | null;
  project_id: number | null;
  project_name?: string | null;
  location: string | null;
  start_time: string;
  reminder_minutes: number | null;
  reminder_sent?: boolean;
  created_by: number | null;
  creator_name?: string | null;
  created_at: string;
  attendees?: { user_id: number; name: string; email: string | null }[];
}
