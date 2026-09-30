import { describe, expect, it } from "vitest";
import {
  createProjectSchema,
  createTaskRequestSchema,
  createTaskSchema,
  decisionSchema,
  taskRequestDecisionSchema,
  updateTaskSchema,
} from "@/lib/validation";

const correction = {
  taskType: "correction",
  title: "Invoice totals round down",
  existingBehavior: "Totals are truncated",
  expectedBehavior: "Totals round half-up",
  acceptanceCriteria: "12.345 shows as 12.35",
};

function issues(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((i) => i.message);
}

describe("createTaskSchema", () => {
  it("accepts a complete correction and blanks optional fields to null", () => {
    const d = createTaskSchema.parse({ ...correction, assigneeId: "4", reason: "  ", scope: "" });
    expect(d.assigneeId).toBe(4);
    expect(d.reason).toBeNull();
    expect(d.scope).toBeNull();
    expect(d.existingBehavior).toBe("Totals are truncated");
  });

  it("requires one of the two types", () => {
    expect(issues(createTaskSchema.safeParse({ title: "x", assigneeId: 4 }))).toContain(
      "Choose a type: existing work correction or new feature"
    );
    expect(
      createTaskSchema.safeParse({ taskType: "general", title: "x", assigneeId: 4 }).success
    ).toBe(false);
  });

  it("requires the type's mandatory fields", () => {
    const res = createTaskSchema.safeParse({
      taskType: "correction",
      title: "x",
      assigneeId: 4,
      existingBehavior: "a",
    });
    expect(issues(res)).toEqual([
      "Expected behavior is required",
      "Acceptance criteria is required",
    ]);
    expect(
      issues(createTaskSchema.safeParse({ taskType: "feature", title: "x", assigneeId: 4, features: "f" }))
    ).toEqual(["Rules is required"]);
  });

  it("requires an assigned owner", () => {
    expect(issues(createTaskSchema.safeParse({ ...correction, assigneeId: "" }))).toContain(
      "An assigned owner is required"
    );
    expect(issues(createTaskSchema.safeParse(correction))).toContain(
      "An assigned owner is required"
    );
  });
});

describe("updateTaskSchema", () => {
  it("keeps a member's status-only update to just { status }", () => {
    // The route rejects any other key for non-managers, so absent optional
    // fields must not appear in the parsed output.
    expect(Object.keys(updateTaskSchema.parse({ status: "review" }))).toEqual(["status"]);
  });

  it("rejects an empty update", () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
  });
});

describe("createTaskRequestSchema", () => {
  it("accepts a feature with optional flow omitted", () => {
    const d = createTaskRequestSchema.parse({
      taskType: "feature",
      title: "CSV export",
      features: "Export tasks",
      rules: "Leads only",
    });
    expect(d.flow).toBeUndefined();
  });

  it("rejects a request missing required spec", () => {
    expect(
      issues(createTaskRequestSchema.safeParse({ taskType: "feature", title: "x", rules: "r" }))
    ).toEqual(["Features is required"]);
  });
});

describe("decisions", () => {
  it("requires a reason to reject", () => {
    expect(decisionSchema.safeParse({ decision: "approve" }).success).toBe(true);
    expect(issues(decisionSchema.safeParse({ decision: "reject", note: "  " }))).toEqual([
      "Give a reason for rejecting",
    ]);
  });

  it("requires an owner to approve a task request", () => {
    expect(issues(taskRequestDecisionSchema.safeParse({ decision: "approve" }))).toEqual([
      "Choose an assigned owner to approve this request",
    ]);
    expect(
      taskRequestDecisionSchema.safeParse({ decision: "approve", assigneeId: 5 }).success
    ).toBe(true);
  });

  it("accepts a nominated lead on a project request", () => {
    expect(createProjectSchema.parse({ name: "Portal", leadId: "3" }).leadId).toBe(3);
  });
});
