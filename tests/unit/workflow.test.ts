import { describe, expect, it } from "vitest";
import {
  canDecideProject,
  canSignOff,
  missingSpecFields,
  normalizeSpec,
  projectCompletionBlockers,
  projectLockReason,
  signOffBlockers,
  SPEC_FIELDS,
  specBodyKey,
  specFromBody,
  taskLockReason,
} from "@/lib/workflow";

describe("spec fields", () => {
  it("defines the correction and feature fields with the right required flags", () => {
    const req = (t: "correction" | "feature") =>
      Object.fromEntries(SPEC_FIELDS[t].map((f) => [f.key, f.required]));
    expect(req("correction")).toEqual({
      existing_behavior: true,
      expected_behavior: true,
      acceptance_criteria: true,
      reason: false,
      scope: false,
    });
    expect(req("feature")).toEqual({ features: true, flow: false, rules: true });
  });

  it("reports blank required fields only (whitespace counts as blank)", () => {
    expect(
      missingSpecFields("correction", {
        existing_behavior: "Totals round down",
        expected_behavior: "   ",
        acceptance_criteria: null,
      }).map((f) => f.key)
    ).toEqual(["expected_behavior", "acceptance_criteria"]);
    expect(missingSpecFields("feature", { features: "Export", rules: "Admins only" })).toEqual([]);
    expect(missingSpecFields("general", {})).toEqual([]);
  });

  it("maps camelCase body keys to spec columns", () => {
    expect(specBodyKey("acceptance_criteria")).toBe("acceptanceCriteria");
    expect(specFromBody({ existingBehavior: "a", flow: null, title: "ignored" })).toEqual({
      existing_behavior: "a",
      flow: null,
    });
  });

  it("normalizes: trims the type's fields and nulls every other column", () => {
    const out = normalizeSpec("feature", {
      features: "  Bulk export  ",
      flow: "",
      rules: "CSV only",
      existing_behavior: "stale value from a previous type",
    });
    expect(out).toEqual({
      existing_behavior: null,
      expected_behavior: null,
      acceptance_criteria: null,
      reason: null,
      scope: null,
      features: "Bulk export",
      flow: null,
      rules: "CSV only",
    });
  });
});

describe("read-only locks", () => {
  it("locks pending, rejected and completed projects", () => {
    expect(projectLockReason({ status: "active", approval_status: "approved" })).toBeNull();
    expect(projectLockReason({ status: "archived", approval_status: "approved" })).toBeNull();
    expect(projectLockReason({ status: "active", approval_status: "pending" })).toMatch(/awaiting/);
    expect(projectLockReason({ status: "active", approval_status: "rejected" })).toMatch(/rejected/);
    expect(projectLockReason({ status: "completed", approval_status: "approved" })).toMatch(/completed/);
  });

  it("locks a task once it is signed off", () => {
    expect(taskLockReason({ signed_off_at: null })).toBeNull();
    expect(taskLockReason({ signed_off_at: "2026-09-17 10:00:00" })).toMatch(/signed off/);
  });
});

describe("sign-off", () => {
  const ready = {
    status: "done" as const,
    signed_off_at: null,
    requested_by: 3,
    request_approved_by: 2,
    assignee_id: 4,
  };

  it("has no blockers when done with a complete trail", () => {
    expect(signOffBlockers(ready)).toEqual([]);
  });

  it("requires done status and every mandatory person", () => {
    expect(
      signOffBlockers({
        status: "review",
        requested_by: null,
        request_approved_by: null,
        assignee_id: null,
      })
    ).toEqual([
      "The task must be marked Done first",
      "Requested by is missing",
      "Approved by is missing — a project lead can sign it off",
      "An assigned owner is missing",
    ]);
    expect(signOffBlockers({ ...ready, signed_off_at: "2026-09-17 10:00:00" })).toContain(
      "The task is already signed off"
    );
  });

  it("is allowed for the requester or a manager only", () => {
    const member = (id: number) => ({ id, role: "member" });
    expect(canSignOff(member(3), false, ready)).toBe(true); // requester
    expect(canSignOff(member(9), true, ready)).toBe(true); // lead
    expect(canSignOff(member(4), false, ready)).toBe(false); // assignee
    expect(canSignOff(member(4), false, { requested_by: null })).toBe(false);
  });

  it("never lets the assigned owner sign off their own work — unless they're an admin", () => {
    const ownWork = { requested_by: 4, assignee_id: 4 };
    expect(canSignOff({ id: 4, role: "member" }, false, ownWork)).toBe(false); // requester + owner
    expect(canSignOff({ id: 4, role: "member" }, true, ownWork)).toBe(false); // lead + owner
    expect(canSignOff({ id: 4, role: "admin" }, true, ownWork)).toBe(true);
  });
});

describe("project decisions and completion", () => {
  it("lets the nominated lead or an admin decide a project request", () => {
    expect(canDecideProject({ id: 7, role: "member" }, { owner_id: 7 })).toBe(true);
    expect(canDecideProject({ id: 1, role: "admin" }, { owner_id: 7 })).toBe(true);
    expect(canDecideProject({ id: 8, role: "member" }, { owner_id: 7 })).toBe(false);
    expect(canDecideProject({ id: 8, role: "member" }, { owner_id: null })).toBe(false);
  });

  it("blocks completion until every task is signed off and no request is pending", () => {
    expect(projectCompletionBlockers({ unsignedTasks: 0, pendingRequests: 0 })).toEqual([]);
    expect(projectCompletionBlockers({ unsignedTasks: 1, pendingRequests: 2 })).toEqual([
      "1 task is not signed off yet",
      "2 task requests are awaiting a decision",
    ]);
  });
});

describe("a task's checklist comes from its own specification", () => {
  const spec = (over: Record<string, unknown> = {}) =>
    ({
      existing_behavior: null,
      expected_behavior: null,
      acceptance_criteria: null,
      reason: null,
      scope: null,
      features: null,
      flow: null,
      rules: null,
      ...over,
    }) as never;

  it("turns a written list into one item per line", async () => {
    const { checklistFromSpec } = await import("@/lib/workflow");
    expect(
      checklistFromSpec(
        "correction",
        spec({
          expected_behavior: "Searching a dealer code finds that dealer.",
          acceptance_criteria: "- Typing D-1042 shows dealer D-1042\n- Partial codes still work",
        })
      )
    ).toEqual([
      "Searching a dealer code finds that dealer.",
      "Typing D-1042 shows dealer D-1042",
      "Partial codes still work",
    ]);
  });

  it("strips the ways people write lists", async () => {
    const { checklistFromSpec } = await import("@/lib/workflow");
    expect(
      checklistFromSpec("feature", spec({ features: "1. Export CSV\n2) Email it\n• Schedule it\n* Done" }))
    ).toEqual(["Export CSV", "Email it", "Schedule it", "Done"]);
  });

  it("takes features and rules for a new feature", async () => {
    const { checklistFromSpec } = await import("@/lib/workflow");
    expect(
      checklistFromSpec("feature", spec({ features: "Dark mode toggle", rules: "Remember per user" }))
    ).toEqual(["Dark mode toggle", "Remember per user"]);
  });

  it("keeps a paragraph as a single item", async () => {
    const { checklistFromSpec } = await import("@/lib/workflow");
    const prose = "The report should open in under two seconds on a normal connection.";
    expect(checklistFromSpec("correction", spec({ expected_behavior: prose }))).toEqual([prose]);
  });

  it("says nothing when the spec says nothing checkable", async () => {
    const { checklistFromSpec } = await import("@/lib/workflow");
    expect(checklistFromSpec("correction", spec())).toEqual([]);
    expect(checklistFromSpec("correction", spec({ acceptance_criteria: "   \n\n  " }))).toEqual([]);
    // A task with no type (created before task types existed) gets nothing.
    expect(checklistFromSpec("general", spec({ features: "x" }))).toEqual([]);
    expect(checklistFromSpec(null, spec({ features: "x" }))).toEqual([]);
  });

  it("does not repeat the same line written in two fields", async () => {
    const { checklistFromSpec } = await import("@/lib/workflow");
    expect(
      checklistFromSpec("feature", spec({ features: "Export CSV", rules: "export csv" }))
    ).toEqual(["Export CSV"]);
  });

  it("will not turn a pasted document into a hundred checkboxes", async () => {
    const { checklistFromSpec } = await import("@/lib/workflow");
    const many = Array.from({ length: 200 }, (_, i) => `Item ${i}`).join("\n");
    expect(checklistFromSpec("feature", spec({ features: many }))).toHaveLength(50);
  });

  it("trims an over-long line to what the column holds", async () => {
    const { checklistFromSpec } = await import("@/lib/workflow");
    const [item] = checklistFromSpec("feature", spec({ features: "x".repeat(400) }));
    expect(item).toHaveLength(255);
  });
});

describe("an existing task can be brought up to its specification", () => {
  const spec = (over: Record<string, unknown> = {}) =>
    ({
      existing_behavior: null,
      expected_behavior: null,
      acceptance_criteria: null,
      reason: null,
      scope: null,
      features: null,
      flow: null,
      rules: null,
      ...over,
    }) as never;

  it("offers only what the checklist does not have yet", async () => {
    const { pendingChecklistItems } = await import("@/lib/workflow");
    expect(
      pendingChecklistItems(
        "feature",
        spec({ features: "Export CSV\nEmail it", rules: "Admins only" }),
        ["Email it"]
      )
    ).toEqual(["Export CSV", "Admins only"]);
  });

  it("matches an existing item ignoring case and surrounding space", async () => {
    const { pendingChecklistItems } = await import("@/lib/workflow");
    expect(
      pendingChecklistItems("feature", spec({ features: "Export CSV" }), ["  export csv  "])
    ).toEqual([]);
  });

  it("offers nothing when the checklist is already complete", async () => {
    const { pendingChecklistItems } = await import("@/lib/workflow");
    expect(
      pendingChecklistItems("correction", spec({ expected_behavior: "It works" }), ["It works"])
    ).toEqual([]);
  });

  it("offers the whole spec to a task with an empty checklist", async () => {
    const { pendingChecklistItems } = await import("@/lib/workflow");
    expect(
      pendingChecklistItems(
        "correction",
        spec({ expected_behavior: "Codes match", acceptance_criteria: "- D-1042 found" }),
        []
      )
    ).toEqual(["Codes match", "D-1042 found"]);
  });

  it("will not push a checklist past the cap", async () => {
    const { pendingChecklistItems } = await import("@/lib/workflow");
    const existing = Array.from({ length: 48 }, (_, i) => `Old ${i}`);
    const many = Array.from({ length: 30 }, (_, i) => `New ${i}`).join("\n");
    expect(pendingChecklistItems("feature", spec({ features: many }), existing)).toHaveLength(2);
  });
});

describe("the backfill script reads a spec the same way the app does", () => {
  const spec = (over: Record<string, unknown> = {}) =>
    ({
      existing_behavior: null,
      expected_behavior: null,
      acceptance_criteria: null,
      reason: null,
      scope: null,
      features: null,
      flow: null,
      rules: null,
      ...over,
    }) as never;

  // scripts/backfill-checklists.mjs cannot import the TypeScript module, so it
  // carries its own copy of the parser. This is the guard against the two
  // drifting apart.
  it("agrees with checklistFromSpec on every case that matters", async () => {
    const { checklistFromSpec } = await import("@/lib/workflow");
    const { checklistItems } = await import("../../scripts/backfill-checklists.mjs");

    const cases: Array<[string, Record<string, unknown>]> = [
      ["correction", { expected_behavior: "A\nB", acceptance_criteria: "- C\n2) D" }],
      ["feature", { features: "1. Export CSV\n• Email it", rules: "Admins only\n\n\nAudited" }],
      ["feature", { features: "Export CSV", rules: "export csv" }],
      ["correction", { expected_behavior: "   \n  \n" }],
      ["correction", { existing_behavior: "Not a source", scope: "Nor this" }],
      ["feature", { features: "x".repeat(400) }],
      ["feature", { features: Array.from({ length: 200 }, (_, i) => `Item ${i}`).join("\n") }],
      ["general", { features: "Ignored" }],
    ];

    for (const [type, fields] of cases) {
      expect(checklistItems(type, spec(fields))).toEqual(
        checklistFromSpec(type as never, spec(fields))
      );
    }
  });
});
