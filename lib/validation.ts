import { z } from "zod";

// Coerce "" / undefined / null to null, otherwise a positive int id.
export const optionalId = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : v),
  z.coerce.number().int().positive().nullable()
);

// Coerce "" / undefined to null, otherwise a YYYY-MM-DD date string.
export const optionalDate = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .nullable()
);

export const optionalText = z
  .string()
  .max(5000)
  .optional()
  .nullable();

// ---- Auth ----
// Credentials are federated to the parent Attendance app: users sign in with
// their attendance Employee ID + numeric PIN (validated against attendance.employees).
export const loginSchema = z.object({
  emp_id: z.string().min(1, "Employee ID is required").max(20),
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
});

// Users are managed in the parent Attendance app — PM has no user-admin or
// password schemas of its own.

// ---- Projects ----
export const createProjectSchema = z.object({
  name: z.string().min(1).max(150),
  description: optionalText,
  status: z.enum(["active", "completed", "archived"]).optional(),
  ownerId: optionalId.optional(),
  memberIds: z.array(z.coerce.number().int().positive()).optional(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().min(1).max(150).optional(),
    description: optionalText,
    status: z.enum(["active", "completed", "archived"]).optional(),
    ownerId: optionalId.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "No fields to update",
  });

export const addMemberSchema = z.object({
  userId: z.coerce.number().int().positive(),
  roleInProject: z.enum(["lead", "member"]).optional(),
});

// ---- Tasks ----
const labelIdsField = z.array(z.coerce.number().int().positive()).optional();

// "" / null / undefined -> null; otherwise a non-negative number of hours.
export const optionalHours = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : v),
  z.coerce.number().min(0).max(9999).nullable()
);

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: optionalText,
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  estimatedHours: optionalHours.optional(),
  assigneeId: optionalId.optional(),
  dueDate: optionalDate.optional(),
  startDate: optionalDate.optional(),
  labelIds: labelIdsField,
  // #7 — additional / follow-up work raised after a task or project completed.
  parentTaskId: optionalId.optional(),
  isAdditional: z.boolean().optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: optionalText,
    status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    estimatedHours: optionalHours.optional(),
    assigneeId: optionalId.optional(),
    dueDate: optionalDate.optional(),
    startDate: optionalDate.optional(),
    labelIds: labelIdsField,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "No fields to update",
  });

// ---- Reminders / scheduled activities (Wave 11) ----
export const createReminderSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(40).optional(),
  notes: optionalText,
  scheduledAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/, "Expected a date and time"),
  reminderMinutes: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? 0 : v),
    z.coerce.number().int().min(0).max(43200) // up to 30 days before
  ),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
  notifyEmail: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
});

export const updateReminderSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    category: z.string().min(1).max(40).optional(),
    notes: optionalText,
    scheduledAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/)
      .optional(),
    reminderMinutes: z.coerce.number().int().min(0).max(43200).optional(),
    recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
    notifyEmail: z.boolean().optional(),
    notifyPush: z.boolean().optional(),
    isDone: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

// ---- Milestones (Wave 10) ----
export const createMilestoneSchema = z.object({
  name: z.string().min(1).max(200),
  dueDate: optionalDate.optional(),
});
export const updateMilestoneSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    dueDate: optionalDate.optional(),
    isDone: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

// ---- Bulk task actions (Wave 10) ----
export const bulkTaskSchema = z.object({
  taskIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
  action: z.enum(["status", "assignee", "priority", "delete"]),
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  assigneeId: optionalId.optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

// ---- Labels ----
export const createLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().max(20).optional(),
});

// ---- Subtasks ----
export const createSubtaskSchema = z.object({
  title: z.string().min(1).max(255),
});

export const updateSubtaskSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    is_done: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "No fields to update",
  });

// ---- Profile ----
export const updateProfileSchema = z.object({
  name: z.string().min(1).max(120),
});

// ---- Comments ----
export const createCommentSchema = z.object({
  body: z.string().min(1).max(5000),
  mentionIds: z.array(z.coerce.number().int().positive()).optional(),
});

// ---- Approval (outstanding tasks) ----
export const approvalSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(1000).optional(),
});

// ---- Meetings ----
// Accepts an HTML datetime-local value ("YYYY-MM-DDTHH:mm") or a full ISO string.
export const createMeetingSchema = z.object({
  title: z.string().min(1).max(200),
  description: optionalText,
  projectId: optionalId.optional(),
  location: z.string().max(255).optional().nullable(),
  startTime: z
    .string()
    .min(1, "Start time is required")
    .regex(
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/,
      "Expected a date and time"
    ),
  reminderMinutes: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? null : v),
    z.coerce.number().int().min(0).max(20160).nullable() // up to 14 days
  ),
  attendeeIds: z.array(z.coerce.number().int().positive()).optional(),
});
