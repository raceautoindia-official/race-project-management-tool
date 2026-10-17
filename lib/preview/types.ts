// Domain types for the redesigned (Project › Task › Subtask) frontend preview.
// These mirror the target schema in docs/REDESIGN_PLAN.md §2.4. The preview runs
// entirely in the browser on sample data — nothing here talks to the database.

export type StatusCategory =
  | "not_started"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";

export const STATUS_CATEGORIES: StatusCategory[] = [
  "not_started",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
];

export type Priority = "low" | "medium" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

export type ProjectState = "planned" | "active" | "on_hold" | "closed";

export interface Department {
  id: string;
  name: string;
  color: string; // key into LABEL_CHIP_CLASSES
}

export interface Designation {
  id: string;
  name: string;
  level: number; // 1 = most junior
}

export interface Person {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  designationId: string | null;
  /** Company admin — manages this company's settings and people. */
  isAdmin: boolean;
  /** Platform owner — manages every company on the platform (not a company member). */
  isSuperAdmin?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  departmentId: string | null;
  startDate: string; // yyyy-MM-dd
  dueDate: string;
  /** Expected (budgeted) working hours for the whole project. */
  expectedHours: number | null;
  state: ProjectState;
  memberIds: string[];
  createdAt: string;
  customFields: Record<string, string>;
}

/** A task (level 1) or subtask (level 2) — one shape, as in the target schema. */
export interface WorkItem {
  id: string;
  projectId: string;
  parentId: string | null; // null → task, set → subtask
  title: string;
  description: string;
  /** Task: the owner. Subtask: the assignee. */
  personId: string | null;
  status: StatusCategory;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  weight: number; // % share of parent (auto items are recomputed)
  weightMode: "auto" | "manual";
  /** Expected working hours. Actual man-hours come from timeLogs. */
  estimatedHours: number | null;
  position: number;
  /** Set when a reviewer sends work back. */
  changesRequested: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  completedLate?: boolean;
  createdAt: string;
}

/** One man-hour entry: who worked on what, when, for how long. */
export interface TimeLog {
  id: string;
  itemId: string;
  personId: string;
  date: string; // yyyy-MM-dd
  hours: number;
  note: string;
}

export interface Comment {
  id: string;
  itemId: string;
  authorId: string;
  body: string;
  createdAt: string;
  kind: "comment" | "system";
}

export interface ActivityEntry {
  id: string;
  projectId: string;
  itemId: string | null;
  actorId: string;
  text: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  personId: string;
  text: string;
  href: string;
  read: boolean;
  createdAt: string;
}

export interface Meeting {
  id: string;
  title: string;
  projectId: string | null;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
  location: string;
  attendeeIds: string[];
}

export interface Reminder {
  id: string;
  personId: string;
  title: string;
  date: string;
  time: string;
  category: string;
}

export interface Terminology {
  project: { one: string; many: string };
  task: { one: string; many: string };
  subtask: { one: string; many: string };
}

export interface CustomField {
  id: string;
  entity: "project" | "task" | "subtask";
  label: string;
  type: "text" | "number" | "date" | "select" | "person";
  options: string[];
  required: boolean;
}

export interface TemplateItem {
  title: string;
  subtasks: string[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  industry: string;
  description: string;
  tasks: TemplateItem[];
}

export interface OrgSettings {
  companyName: string;
  industry: string;
  terminology: Terminology;
  statusLabels: Record<StatusCategory, string>;
  /** How project progress is computed — see engine.projectProgress. */
  progressMode: "approved_tasks" | "partial";
  /** Used to turn hours into capacity and utilisation. */
  workingHoursPerDay: number;
  workingDays: number[]; // 0 = Sunday … 6 = Saturday
  timezone: string;
  country: string;
}

export type CompanyStatus = "active" | "trial" | "suspended" | "onboarding";

/** A tenant on the platform, as the super admin sees it. */
export interface Company {
  id: string;
  name: string;
  industry: string;
  country: string;
  plan: "Starter" | "Business" | "Enterprise";
  status: CompanyStatus;
  seats: number;
  users: number;
  activeProjects: number;
  hoursThisMonth: number;
  adminName: string;
  adminEmail: string;
  createdAt: string;
  lastActiveAt: string;
  /** The tenant whose full data this preview shows. */
  isDemoTenant?: boolean;
}

export interface PreviewState {
  version: number;
  currentUserId: string;
  org: OrgSettings;
  departments: Department[];
  designations: Designation[];
  people: Person[];
  projects: Project[];
  items: WorkItem[];
  comments: Comment[];
  activity: ActivityEntry[];
  notifications: Notification[];
  meetings: Meeting[];
  reminders: Reminder[];
  customFields: CustomField[];
  templates: ProjectTemplate[];
  timeLogs: TimeLog[];
  companies: Company[];
  platformAdmins: Person[];
}
