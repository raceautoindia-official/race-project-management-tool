export type Role = "admin" | "member";
export type ProjectStatus = "active" | "completed" | "archived";
export type ProjectRole = "lead" | "member";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type ApprovalStatus = "none" | "pending" | "approved" | "rejected";
/** A requested project / raised task request awaiting a lead's decision. */
export type RequestStatus = "pending" | "approved" | "rejected";
/** How a piece of work was specified. `general` = legacy / imported / recurring. */
export type WorkType = "general" | "correction" | "feature";

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
  /** Mobile number for WhatsApp alerts (E.164-ish, as typed). */
  phone?: string | null;
  whatsapp_opt_in?: boolean;
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
  // Project request → lead approval.
  approval_status?: RequestStatus;
  requested_by?: number | null;
  requester_name?: string | null;
  requested_at?: string | null;
  decided_by?: number | null;
  decider_name?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
}

/** The structured spec of a correction / new-feature piece of work. */
export interface SpecColumns {
  // Existing work correction
  existing_behavior?: string | null;
  expected_behavior?: string | null;
  acceptance_criteria?: string | null;
  reason?: string | null;
  scope?: string | null;
  // New feature
  features?: string | null;
  flow?: string | null;
  rules?: string | null;
}

export interface ProjectMember {
  id: number;
  project_id: number;
  user_id: number;
  role_in_project: ProjectRole;
  name: string;
  email: string;
}

export interface Task extends SpecColumns {
  id: number;
  project_id: number;
  project_name?: string;
  title: string;
  description: string | null;
  task_type?: WorkType;
  // Approval trail: who requested → who approved → who signed off (then locked).
  request_id?: number | null;
  requested_by?: number | null;
  requester_name?: string | null;
  requested_at?: string | null;
  request_approved_by?: number | null;
  request_approver_name?: string | null;
  request_approved_at?: string | null;
  signed_off_by?: number | null;
  signer_name?: string | null;
  /** Who marked it Done (approved its completion). */
  done_by_name?: string | null;
  signed_off_at?: string | null;
  signoff_note?: string | null;
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

/** A task raised by a project member, waiting for a lead to approve it. */
export interface TaskRequest extends SpecColumns {
  id: number;
  project_id: number;
  task_type: Exclude<WorkType, "general">;
  title: string;
  /** Urgency and effort as stated by whoever asked for the work. */
  priority: TaskPriority;
  estimated_hours: number | null;
  due_date: string | null;
  status: RequestStatus;
  requested_by: number | null;
  requester_name?: string | null;
  requested_at: string;
  decided_by: number | null;
  decider_name?: string | null;
  decided_at: string | null;
  decision_note: string | null;
  task_id: number | null;
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
  /** Video call join link (a room in the meetings app, or a pasted link). */
  video_url?: string | null;
  video_room_id?: string | null;
  start_time: string;
  duration_minutes?: number;
  reminder_minutes: number | null;
  reminder_sent?: boolean;
  recurrence?: Recurrence;
  series_id?: number | null;
  created_by: number | null;
  creator_name?: string | null;
  created_at: string;
  attendees?: { user_id: number; name: string; email: string | null }[];
}

// ---- Recurring tasks + project templates (Wave 12) ----
export type RecurringInterval = "daily" | "weekly" | "monthly";

export interface RecurringTask {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  assignee_id: number | null;
  assignee_name?: string | null;
  estimated_hours: number | null;
  recurrence: RecurringInterval;
  next_run: string;
  is_active: boolean;
  created_by: number | null;
  created_at?: string;
}

export interface ProjectTemplate {
  id: number;
  name: string;
  description: string | null;
  created_by: number | null;
  created_by_name?: string | null;
  task_count?: number;
  created_at?: string;
}
