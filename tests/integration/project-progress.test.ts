import { beforeAll, describe, expect, it } from "vitest";
import { query, DbResult, DbRow } from "@/lib/db";
import type { Task, User } from "@/lib/types";
import { createLedProject, createUser } from "./helpers";
import {
  PROJECT_CREDITED_SQL,
  PROJECT_UNITS_SQL,
  projectPercent,
  projectUnitsOf,
} from "@/lib/progress";
import { fetchTasks } from "@/lib/tasks";

/**
 * Since the 2026-10-17 redesign a task's completion is the weighted share of
 * its subtasks its owner has approved, and a project's is each task's
 * approved share by the task's weight (a Done task counts in full).
 *
 * The project sum exists twice — once in SQL for the lists that never load a
 * project's tasks, once in TypeScript for pages that already have them.
 * These tests exist so the two cannot drift apart.
 */
describe("project completion", () => {
  let lead: User;
  let projectId: number;

  async function addTask(
    status: string,
    subtasks: string[],
    weight?: number
  ): Promise<number> {
    const res = (await query<DbResult>(
      `INSERT INTO tasks (project_id, title, status, assignee_id, weight, weight_mode)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, `Task ${status} ${subtasks.length}`, status, lead.id, weight ?? 0, weight === undefined ? "auto" : "manual"]
    )) as unknown as DbResult;
    for (const s of subtasks) {
      await query(
        `INSERT INTO subtasks (task_id, title, status, is_done) VALUES (?, 'item', ?, ?)`,
        [res.insertId, s, s === "done" ? 1 : 0]
      );
    }
    return res.insertId;
  }

  let partly: number;

  beforeAll(async () => {
    lead = await createUser("ProgressLead");
    projectId = await createLedProject(lead, "Progress project");
    // Fixed at 50%: three of four subtasks approved, one waiting for review.
    partly = await addTask("in_progress", ["done", "done", "done", "review"], 50);
    // Done counts in full; the two auto tasks share the other 50%.
    await addTask("done", ["done", "todo"]);
    await addTask("todo", []);
  });

  it("counts each task's approved share by the task's weight", async () => {
    const rows = await query<DbRow[]>(
      `SELECT ${PROJECT_UNITS_SQL} AS units, ${PROJECT_CREDITED_SQL} AS credited
         FROM projects p WHERE p.id = ?`,
      [projectId]
    );
    const units = Number(rows[0].units);
    const credited = Number(rows[0].credited);
    expect(units).toBeCloseTo(100, 5); // 50 + 25 + 25
    // 50% × 3/4 approved + the Done task's 25% + nothing from the To do task
    expect(credited).toBeCloseTo(62.5, 5);
    expect(projectPercent({ units, credited })).toBe(63);
  });

  it("agrees with the figure worked out from loaded tasks", async () => {
    // The page loads tasks through fetchTasks, which works out each one's
    // approved share (progress_approved).
    const inBrowser = projectUnitsOf((await fetchTasks("t.project_id = ?", [projectId])) as unknown as Task[]);
    const rows = await query<DbRow[]>(
      `SELECT ${PROJECT_UNITS_SQL} AS units, ${PROJECT_CREDITED_SQL} AS credited
         FROM projects p WHERE p.id = ?`,
      [projectId]
    );
    expect(inBrowser.units).toBeCloseTo(Number(rows[0].units), 3);
    expect(inBrowser.credited).toBeCloseTo(Number(rows[0].credited), 1);
  });

  it("gives each task its approved share, with work in review reported apart", async () => {
    const [task] = await fetchTasks("t.id = ?", [partly]);
    expect(task.subtask_total).toBe(4);
    expect(task.subtask_done).toBe(3);
    expect(task.progress_approved).toBe(75);
    expect(task.progress_pending).toBe(25);
  });

  it("is zero, not an error, for a project with no tasks at all", async () => {
    const emptyId = await createLedProject(lead, "Nothing in it");
    const rows = await query<DbRow[]>(
      `SELECT ${PROJECT_UNITS_SQL} AS units, ${PROJECT_CREDITED_SQL} AS credited
         FROM projects p WHERE p.id = ?`,
      [emptyId]
    );
    expect(Number(rows[0].units)).toBe(0);
    expect(
      projectPercent({
        units: Number(rows[0].units),
        credited: Number(rows[0].credited),
      })
    ).toBe(0);
    expect(projectUnitsOf([])).toEqual({ units: 0, credited: 0 });
  });
});
