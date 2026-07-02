export type Role = "admin" | "member";
export type ProjectStatus = "active" | "completed" | "archived";
export type ProjectRole = "lead" | "member";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

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
  priority: TaskPriority;
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
  created_at: string;
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
