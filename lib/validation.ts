import { z } from "zod";
import {
  missingSpecFields,
  specBodyKey,
  specFromBody,
} from "./workflow";
import type { WorkType } from "./types";

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

/**
 * A date range has to run forwards. Checked only when both ends are in the
 * same request: a partial update that touches one date cannot be compared
 * against the other without reading the stored row.
 */
function checkDateOrder(
  d: { startDate?: string | null; dueDate?: string | null },
  ctx: z.RefinementCtx
) {
  if (d.startDate && d.dueDate && d.dueDate < d.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["dueDate"],
      message: "The end date can't be before the start date",
    });
  }
}

export const optionalText = z
  .string()
  .max(5000)
  .optional()
  .nullable();

// Coerce "" / whitespace / null / undefined to null, otherwise a positive int
// id; a missing value fails with `message`.
const requiredId = (message: string) =>
  z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number({ error: message }).int().positive(message)
  );

// Spec text: blank → null, otherwise trimmed text.
const specText = z
  .preprocess(
    (v) => (typeof v === "string" ? v.trim() || null : v ?? null),
    z.string().max(5000).nullable()
  )
  .optional();

const specShape = {
  existingBehavior: specText,
  expectedBehavior: specText,
  acceptanceCriteria: specText,
  reason: specText,
  scope: specText,
  features: specText,
  flow: specText,
  rules: specText,
};

/** Issues for the required spec fields of `taskType` that are blank. */
function specIssues(d: { taskType?: WorkType } & Record<string, unknown>) {
  return missingSpecFields(d.taskType, specFromBody(d)).map((f) => ({
    code: "custom" as const,
    path: [specBodyKey(f.key)],
    message: `${f.label} is required`,
  }));
}

const specTypeField = z.enum(["correction", "feature"], {
  error: "Choose a type: existing work correction or new feature",
});

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
  // Non-admins request a project: the nominated lead approves it.
  leadId: optionalId.optional(),
});

/** Approve / reject a pending request. A rejection must say why. */
export const decisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.decision === "reject" && !d.note) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Give a reason for rejecting",
      });
    }
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

// Tasks created by an admin/lead: one of the two spec types, with the
// requester and assigned owner mandatory (the creator is the approver).
export const createTaskSchema = z
  .object({
    taskType: specTypeField,
    title: z.string().trim().min(1, "Title is required").max(200),
    description: optionalText,
    ...specShape,
    requestedById: optionalId.optional(),
    status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    estimatedHours: optionalHours.optional(),
    assigneeId: requiredId("An assigned owner is required"),
    dueDate: optionalDate.optional(),
    startDate: optionalDate.optional(),
    labelIds: labelIdsField,
    // #7 — additional / follow-up work raised after a task or project completed.
    parentTaskId: optionalId.optional(),
    isAdditional: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    specIssues(d).forEach((i) => ctx.addIssue(i));
    checkDateOrder(d, ctx);
  });

// Required spec fields are checked in the route against the merged task, so a
// partial update cannot blank them out.
export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: optionalText,
    taskType: specTypeField.optional(),
    ...specShape,
    requestedById: optionalId.optional(),
    status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    estimatedHours: optionalHours.optional(),
    assigneeId: optionalId.optional(),
    dueDate: optionalDate.optional(),
    startDate: optionalDate.optional(),
    labelIds: labelIdsField,
  })
  .superRefine(checkDateOrder)
  .refine((d) => Object.keys(d).length > 0, {
    message: "No fields to update",
  });

// ---- Task requests (raised by members, approved by a lead) ----
export const createTaskRequestSchema = z
  .object({
    taskType: specTypeField,
    title: z.string().trim().min(1, "Title is required").max(200),
    // How urgent it is and how long it should take are stated by the person
    // asking for the work, who is usually closer to it than the approver.
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    estimatedHours: optionalHours.optional(),
    startDate: optionalDate.optional(),
    dueDate: optionalDate.optional(),
    ...specShape,
  })
  .superRefine((d, ctx) => {
    specIssues(d).forEach((i) => ctx.addIssue(i));
    checkDateOrder(d, ctx);
  });

/** Approving a request turns it into a task, so it needs an assigned owner. */
export const taskRequestDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(1000).optional().nullable(),
    assigneeId: optionalId.optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    estimatedHours: optionalHours.optional(),
    dueDate: optionalDate.optional(),
    startDate: optionalDate.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.decision === "approve" && !d.assigneeId) {
      ctx.addIssue({
        code: "custom",
        path: ["assigneeId"],
        message: "Choose an assigned owner to approve this request",
      });
    }
    if (d.decision === "reject" && !d.note) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Give a reason for rejecting",
      });
    }
  });

export const signOffSchema = z.object({
  note: z.string().trim().max(1000).optional().nullable(),
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
  /** E.164-ish; blank clears it. Checked properly in lib/whatsapp.ts. */
  phone: z
    .string()
    .max(20)
    .regex(/^\+?[\d\s()-]*$/, "Use digits, spaces and + only")
    .optional()
    .nullable(),
  whatsappOptIn: z.boolean().optional(),
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
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
  attendeeIds: z.array(z.coerce.number().int().positive()).optional(),
  durationMinutes: z.coerce.number().int().min(5).max(720).optional(),
  /** "room" creates a room in the meetings app; "link" uses videoUrl; "none". */
  video: z.enum(["none", "room", "link"]).optional(),
  videoUrl: z.string().max(500).optional().nullable(),
});

// ---- Recurring tasks + project templates (Wave 12) ----
export const createRecurringTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: optionalText,
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assigneeId: optionalId.optional(),
  estimatedHours: optionalHours.optional(),
  recurrence: z.enum(["daily", "weekly", "monthly"]),
  nextRun: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
});

export const saveTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: optionalText,
  projectId: z.coerce.number().int().positive(),
});

export const instantiateTemplateSchema = z.object({
  name: z.string().min(1).max(150),
});
