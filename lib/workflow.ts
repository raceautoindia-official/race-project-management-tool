// Work types, their spec fields, and the request → approve → sign-off → locked
// lifecycle rules. Pure (no DB or server imports) so route handlers and client
// components share one source of truth, and the rules are unit-testable.

import type {
  ProjectStatus,
  RequestStatus,
  SpecColumns,
  TaskStatus,
  WorkType,
} from "./types";

export type SpecKey = keyof SpecColumns;
export type SpecType = Exclude<WorkType, "general">;

export interface SpecField {
  key: SpecKey;
  label: string;
  required: boolean;
  hint: string;
}

export const SPEC_TYPES: SpecType[] = ["correction", "feature"];

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  correction: "Existing work correction",
  feature: "New feature",
  general: "General task",
};

export const SPEC_FIELDS: Record<SpecType, SpecField[]> = {
  correction: [
    {
      key: "existing_behavior",
      label: "Existing behavior",
      required: true,
      hint: "What happens today",
    },
    {
      key: "expected_behavior",
      label: "Expected behavior",
      required: true,
      hint: "What should happen instead",
    },
    {
      key: "acceptance_criteria",
      label: "Acceptance criteria",
      required: true,
      hint: "How we verify the correction is complete",
    },
    { key: "reason", label: "Reason", required: false, hint: "Why this is needed" },
    { key: "scope", label: "Scope", required: false, hint: "What is in / out of scope" },
  ],
  feature: [
    {
      key: "features",
      label: "Features",
      required: true,
      hint: "What the feature must do",
    },
    { key: "flow", label: "Flow", required: false, hint: "Step-by-step user flow" },
    {
      key: "rules",
      label: "Rules",
      required: true,
      hint: "Business rules and constraints",
    },
  ],
};

export const SPEC_KEYS: SpecKey[] = [
  "existing_behavior",
  "expected_behavior",
  "acceptance_criteria",
  "reason",
  "scope",
  "features",
  "flow",
  "rules",
];

export function specFieldsFor(type: WorkType | null | undefined): SpecField[] {
  return type === "correction" || type === "feature" ? SPEC_FIELDS[type] : [];
}

/** snake_case column → camelCase API body key (existing_behavior → existingBehavior). */
export function specBodyKey(key: SpecKey): string {
  return key.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
}

/** Pull the spec fields out of a camelCase request body. */
export function specFromBody(body: Record<string, unknown>): SpecColumns {
  const spec: SpecColumns = {};
  for (const key of SPEC_KEYS) {
    const v = body[specBodyKey(key)];
    if (v !== undefined) spec[key] = v == null ? null : String(v);
  }
  return spec;
}

/** Required fields of `type` that are blank in `spec`. */
export function missingSpecFields(
  type: WorkType | null | undefined,
  spec: SpecColumns
): SpecField[] {
  return specFieldsFor(type).filter(
    (f) => f.required && !(spec[f.key] ?? "").trim()
  );
}

/**
 * Column values to store for a spec: trimmed text for the fields that belong to
 * `type`, null for every other spec column (so switching type leaves no stale
 * fields behind).
 */
export function normalizeSpec(
  type: WorkType,
  spec: SpecColumns
): Record<SpecKey, string | null> {
  const allowed = new Set(specFieldsFor(type).map((f) => f.key));
  const out = {} as Record<SpecKey, string | null>;
  for (const key of SPEC_KEYS) {
    const v = allowed.has(key) ? (spec[key] ?? "").trim() : "";
    out[key] = v === "" ? null : v;
  }
  return out;
}

// ---- Read-only locks ------------------------------------------------------

export interface LockableProject {
  status: ProjectStatus;
  approval_status?: RequestStatus | null;
}

/** Why a project cannot be changed right now, or null if it is writable. */
export function projectLockReason(p: LockableProject): string | null {
  if (p.approval_status === "pending") {
    return "This project is awaiting lead approval and is read-only until it is approved.";
  }
  if (p.approval_status === "rejected") {
    return "This project request was rejected and is read-only.";
  }
  if (p.status === "completed") {
    return "This project is completed and read-only.";
  }
  return null;
}

/** Why a task cannot be changed right now, or null if it is writable. */
export function taskLockReason(t: { signed_off_at?: string | null }): string | null {
  return t.signed_off_at ? "This task is signed off and read-only." : null;
}

// ---- Sign-off --------------------------------------------------------------

export interface SignOffCandidate {
  status: TaskStatus;
  signed_off_at?: string | null;
  requested_by?: number | null;
  request_approved_by?: number | null;
  assignee_id: number | null;
}

/**
 * The mandatory things still missing before a task can be signed off. A
 * missing approver doesn't block an admin/lead: their sign-off records them as
 * the approver too.
 */
export function signOffBlockers(
  t: SignOffCandidate,
  opts: { signerIsManager?: boolean } = {}
): string[] {
  const blockers: string[] = [];
  if (t.signed_off_at) blockers.push("The task is already signed off");
  if (t.status !== "done") blockers.push("The task must be marked Done first");
  if (!t.requested_by) blockers.push("Requested by is missing");
  if (!t.request_approved_by && !opts.signerIsManager) {
    blockers.push("Approved by is missing — a project lead can sign it off");
  }
  if (!t.assignee_id) blockers.push("An assigned owner is missing");
  return blockers;
}

export interface SignOffActor {
  id: number;
  role: string;
}

/**
 * Sign-off is done by the person who requested the work, or an admin/lead —
 * but never by the task's own assigned owner (unless they are an admin).
 */
export function canSignOff(
  user: SignOffActor,
  manager: boolean,
  t: { requested_by?: number | null; assignee_id?: number | null }
): boolean {
  if (isOwnWork(user, t)) return false;
  return manager || (t.requested_by != null && t.requested_by === user.id);
}

/** The user is the task's assigned owner and not an admin. */
export function isOwnWork(
  user: SignOffActor,
  t: { assignee_id?: number | null }
): boolean {
  return t.assignee_id != null && t.assignee_id === user.id && user.role !== "admin";
}

// ---- Project completion ----------------------------------------------------

export interface CompletionCounts {
  /** Tasks in the project not yet signed off. */
  unsignedTasks: number;
  /** Raised task requests still awaiting a decision. */
  pendingRequests: number;
}

/** Why a project cannot be marked Completed yet (empty = it can). */
export function projectCompletionBlockers(c: CompletionCounts): string[] {
  const blockers: string[] = [];
  if (c.unsignedTasks > 0) {
    blockers.push(
      `${c.unsignedTasks} task${c.unsignedTasks === 1 ? " is" : "s are"} not signed off yet`
    );
  }
  if (c.pendingRequests > 0) {
    blockers.push(
      `${c.pendingRequests} task request${c.pendingRequests === 1 ? " is" : "s are"} awaiting a decision`
    );
  }
  return blockers;
}

/** A project request is decided by its nominated lead (owner) or an admin. */
export function canDecideProject(
  user: { id: number; role: string },
  project: { owner_id: number | null }
): boolean {
  return user.role === "admin" || (project.owner_id != null && project.owner_id === user.id);
}

/**
 * Which spec fields describe "done" for each kind of work. These become the
 * task's checklist, so progress is measured against what was actually asked
 * for rather than against a list someone retypes afterwards.
 */
const CHECKLIST_SOURCES: Record<SpecType, SpecKey[]> = {
  correction: ["expected_behavior", "acceptance_criteria"],
  feature: ["features", "rules"],
};

/** One checklist item per line, with list markers and numbering removed. */
function linesOf(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        // "- ", "* ", "• ", "1. ", "1) " — how people write lists.
        .replace(/^\s*(?:[-*•‣▪]|\d+[.)])\s+/, "")
        .trim()
    )
    .filter((line) => line.length > 0)
    .map((line) => line.slice(0, 255));
}

/** Guardrail: a pasted document should not become a hundred checkboxes. */
const MAX_CHECKLIST_ITEMS = 50;

/**
 * Checklist items for a new task, taken from its own specification.
 *
 * A single paragraph becomes a single item; a written list becomes one item
 * per line. Nothing is invented — if the spec says nothing checkable, the
 * task starts with an empty checklist as before.
 */
export function checklistFromSpec(
  type: WorkType | null | undefined,
  spec: SpecColumns
): string[] {
  const keys = type === "correction" || type === "feature" ? CHECKLIST_SOURCES[type] : [];
  const items: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    for (const line of linesOf(spec[key])) {
      // The same sentence in two fields is one thing to do, not two.
      const fingerprint = line.toLowerCase();
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      items.push(line);
      if (items.length >= MAX_CHECKLIST_ITEMS) return items;
    }
  }
  return items;
}
