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
