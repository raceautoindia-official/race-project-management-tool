import { describe, expect, it } from "vitest";
import {
  effectiveWeights,
  makeRoom,
  projectProgress,
  rebalance,
  scheduleHealth,
  forecast,
  subtaskSubmitOutcome,
  taskProgress,
  taskStatusAfterSubtaskChange,
  weightsProblem,
  type SubtaskForProgress,
} from "@/lib/work-engine";
import { can, type SpineContext } from "@/lib/permissions";

const auto = (id: number, extra: Partial<SubtaskForProgress> = {}): SubtaskForProgress => ({
  id,
  weight: 0,
  weight_mode: "auto",
  status: "todo",
  ...extra,
});

describe("weights", () => {
  it("splits evenly by default", () => {
    const w = effectiveWeights([auto(1), auto(2), auto(3), auto(4)]);
    expect([...w.values()]).toEqual([25, 25, 25, 25]);
  });

  it("lets auto items share what manual ones leave", () => {
    const w = effectiveWeights([
      { id: 1, weight: "50.000", weight_mode: "manual" }, // DECIMAL as a string
      { id: 2, weight: 0, weight_mode: "auto" },
      { id: 3, weight: 0, weight_mode: "auto" },
    ]);
    expect(w.get(1)).toBe(50);
    expect(w.get(2)).toBe(25);
    expect(w.get(3)).toBe(25);
  });

  it("gives cancelled items no share and spreads theirs", () => {
    const w = effectiveWeights([{ ...auto(1), cancelled: true }, auto(2), auto(3)]);
    expect([w.get(1), w.get(2), w.get(3)]).toEqual([0, 50, 50]);
  });

  it("makes room for a newcomer when every weight is fixed", () => {
    const room = makeRoom([
      { id: 1, weight: 60, weight_mode: "manual" },
      { id: 2, weight: 40, weight_mode: "manual" },
    ]);
    expect(room.get(1)).toBe(40);
    expect(room.get(2)).toBeCloseTo(26.7);
    // The newcomer (auto) then gets what is left: an even third.
    const after = effectiveWeights([
      { id: 1, weight: room.get(1)!, weight_mode: "manual" },
      { id: 2, weight: room.get(2)!, weight_mode: "manual" },
      { id: 3, weight: 0, weight_mode: "auto" },
    ]);
    expect(after.get(3)).toBeCloseTo(33.3, 0);
  });

  it("leaves auto sets alone when adding", () => {
    expect(makeRoom([auto(1), auto(2)]).size).toBe(0);
  });

  it("rebalances the others so the total stays 100", () => {
    const start = [15, 25, 25, 10, 25].map((w, i) => ({ id: i + 1, weight: w, locked: false }));
    const next = rebalance(start, 1, 40);
    const total = next.reduce((s, d) => s + d.weight, 0);
    expect(total).toBeCloseTo(100, 5);
    expect(next[0]).toEqual({ id: 1, weight: 40, locked: true });
    // The others keep their proportions (25:25:10:25).
    expect(next[1].weight).toBeCloseTo(next[2].weight, 0); // within rounding
    expect(next[1].weight / next[3].weight).toBeCloseTo(2.5, 1);
  });

  it("keeps locked items still, and caps a value at what is free", () => {
    let d = [1, 2, 3].map((id) => ({ id, weight: 33.3, locked: false }));
    d = rebalance(d, 1, 50); // 1 locked at 50
    d = rebalance(d, 2, 80); // only 50 is free: 2 is capped, 3 absorbs
    expect(d.find((x) => x.id === 1)!.weight).toBe(50);
    expect(d.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(100, 5);
    expect(d.every((x) => x.weight >= 0)).toBe(true);
  });

  it("checks a submitted set of weights", () => {
    expect(weightsProblem([50, 50])).toBeNull();
    expect(weightsProblem([33.3, 33.3, 33.4])).toBeNull();
    expect(weightsProblem([60, 60])).toMatch(/add up to 100/);
    expect(weightsProblem([-5, 105])).toMatch(/between 0 and 100/);
  });
});

describe("progress counts approved work only", () => {
  it("rolls approved subtasks up into the task, pending separately", () => {
    const p = taskProgress("in_progress", [
      auto(1, { status: "done" }),
      auto(2, { status: "done" }),
      auto(3, { status: "review" }),
      auto(4, { status: "in_progress" }),
    ]);
    expect(p.approved).toBe(50);
    expect(p.pending).toBe(25);
  });

  it("ignores cancelled subtasks", () => {
    const p = taskProgress("in_progress", [auto(1, { status: "done" }), auto(2, { status: "cancelled" })]);
    expect(p.approved).toBe(100);
  });

  it("treats a task without subtasks by its own status", () => {
    expect(taskProgress("review", [])).toEqual({ approved: 0, pending: 100 });
    expect(taskProgress("in_progress", [])).toEqual({ approved: 0, pending: 0 });
    expect(taskProgress("done", [auto(1)])).toEqual({ approved: 100, pending: 0 });
  });

  it("moves the project when a task is approved, by its weight", () => {
    const p = projectProgress([
      { id: 1, weight: 60, weight_mode: "manual", status: "done" },
      { id: 2, weight: 40, weight_mode: "manual", status: "review" },
    ]);
    expect(p).toEqual({ approved: 60, pending: 40 });
    expect(projectProgress([])).toEqual({ approved: 0, pending: 0 });
  });

  it("moves the project as soon as a subtask is approved", () => {
    // Task 2 is worth 40% of the project; half of its subtasks are approved
    // and a quarter waits for review → +20% approved, +10% pending.
    const p = projectProgress([
      { id: 1, weight: 60, weight_mode: "manual", status: "todo", progress: { approved: 0, pending: 0 } },
      { id: 2, weight: 40, weight_mode: "manual", status: "in_progress", progress: { approved: 50, pending: 25 } },
    ]);
    expect(p.approved).toBeCloseTo(20, 5);
    expect(p.pending).toBeCloseTo(10, 5);
    // A Done task is 100% whatever its subtasks say.
    expect(
      projectProgress([{ id: 1, weight: 100, weight_mode: "manual", status: "done", progress: { approved: 40, pending: 0 } }])
    ).toEqual({ approved: 100, pending: 0 });
  });
});

describe("automatic task status", () => {
  it("sends the task to review when every subtask is approved", () => {
    expect(taskStatusAfterSubtaskChange("in_progress", [{ status: "done" }, { status: "cancelled" }])).toBe("review");
    expect(taskStatusAfterSubtaskChange("todo", [{ status: "done" }])).toBe("review");
  });

  it("pulls a task back when new or reopened work appears", () => {
    expect(taskStatusAfterSubtaskChange("review", [{ status: "done" }, { status: "todo" }])).toBe("in_progress");
    expect(taskStatusAfterSubtaskChange("done", [{ status: "in_progress" }])).toBe("in_progress");
  });

  it("starts the task when its first subtask starts", () => {
    expect(taskStatusAfterSubtaskChange("todo", [{ status: "in_progress" }, { status: "todo" }])).toBe("in_progress");
    expect(taskStatusAfterSubtaskChange("todo", [{ status: "todo" }])).toBeNull();
    expect(taskStatusAfterSubtaskChange("in_progress", [])).toBeNull();
  });

  it("approves at once when the task owner finishes their own subtask", () => {
    expect(subtaskSubmitOutcome(7, 7)).toBe("done");
    expect(subtaskSubmitOutcome(8, 7)).toBe("review");
    expect(subtaskSubmitOutcome(8, null)).toBe("review");
  });
});

describe("schedule health", () => {
  it("compares approved progress with the time elapsed", () => {
    expect(scheduleHealth(50, "2026-10-01", "2026-10-21", "2026-10-11").health).toBe("on_track");
    expect(scheduleHealth(35, "2026-10-01", "2026-10-21", "2026-10-11").health).toBe("at_risk");
    expect(scheduleHealth(10, "2026-10-01", "2026-10-21", "2026-10-11").health).toBe("off_track");
    expect(scheduleHealth(0, "2026-11-01", "2026-11-21", "2026-10-11").health).toBe("not_started");
    expect(scheduleHealth(100, null, null, "2026-10-11").health).toBe("done");
    expect(scheduleHealth(20, "2026-10-01", null, "2026-10-11").health).toBe("no_dates");
  });
});

describe("forecast", () => {
  // 1–20 Oct is 20 days; on the 10th, 10 of them are used.
  it("projects the finish from the pace so far", () => {
    const onPace = forecast(50, "2026-10-01", "2026-10-20", "2026-10-10");
    expect(onPace).toMatchObject({ kind: "projected", eta: "2026-10-20", daysLate: 0, elapsedDays: 10, totalDays: 20, daysLeft: 10 });
    expect(onPace.timePct).toBe(50);
    const slow = forecast(25, "2026-10-01", "2026-10-20", "2026-10-10");
    expect(slow).toMatchObject({ kind: "projected", eta: "2026-11-09", daysLate: 20 });
    const fast = forecast(80, "2026-10-01", "2026-10-20", "2026-10-10");
    expect(fast.daysLate).toBeLessThan(0);
  });

  it("says why there is no forecast", () => {
    expect(forecast(100, "2026-10-01", "2026-10-20", "2026-10-10").kind).toBe("done");
    expect(forecast(30, null, "2026-10-20", "2026-10-10").kind).toBe("no_start");
    expect(forecast(0, "2026-11-01", "2026-11-20", "2026-10-10")).toMatchObject({ kind: "not_started", elapsedDays: 0, timePct: 0 });
    expect(forecast(0, "2026-10-01", "2026-10-20", "2026-10-10").kind).toBe("no_pace");
  });

  it("still projects without a due date, and caps time used once it is overdue", () => {
    expect(forecast(50, "2026-10-01", null, "2026-10-10")).toMatchObject({ kind: "projected", eta: "2026-10-20", daysLate: null, timePct: null });
    expect(forecast(50, "2026-10-01", "2026-10-05", "2026-10-10")).toMatchObject({ timePct: 100, daysLeft: -5 });
  });
});

describe("permissions on the spine", () => {
  const base: SpineContext = { userId: 5, isAdmin: false, projectRole: "member", projectOwnerId: 1, taskOwnerId: 2, subtaskAssigneeId: 3 };

  it("lets the task owner run the task's subtasks and review them", () => {
    const c = { ...base, userId: 2 };
    for (const a of ["subtask.create", "subtask.assign", "subtask.weights", "subtask.work", "subtask.review", "subtask.reopen"] as const) {
      expect(can(a, c)).toBe(true);
    }
    expect(can("task.weights", c)).toBe(false);
  });

  it("lets the assignee work but not review or reshape", () => {
    const c = { ...base, userId: 3 };
    expect(can("subtask.work", c)).toBe(true);
    expect(can("subtask.review", c)).toBe(false);
    expect(can("subtask.create", c)).toBe(false);
  });

  it("gives managers the task weights; the owner counts even without a lead row", () => {
    expect(can("task.weights", { ...base, userId: 1 })).toBe(true);
    expect(can("task.weights", { ...base, projectRole: "lead" })).toBe(true);
    expect(can("task.weights", base)).toBe(false);
  });

  it("routes review to the task owner, or to managers when there is none", () => {
    expect(can("subtask.review", { ...base, projectRole: "lead" })).toBe(false);
    expect(can("subtask.review", { ...base, projectRole: "lead", taskOwnerId: null })).toBe(true);
    expect(can("subtask.review", { ...base, isAdmin: true })).toBe(true);
  });

  it("refuses a bystander everything", () => {
    for (const a of ["task.weights", "subtask.create", "subtask.work", "subtask.review"] as const) {
      expect(can(a, base)).toBe(false);
    }
  });
});
