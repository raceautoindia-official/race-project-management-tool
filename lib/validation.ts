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

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: optionalText,
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assigneeId: optionalId.optional(),
  dueDate: optionalDate.optional(),
  labelIds: labelIdsField,
});

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: optionalText,
    status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    assigneeId: optionalId.optional(),
    dueDate: optionalDate.optional(),
    labelIds: labelIdsField,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "No fields to update",
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
});
