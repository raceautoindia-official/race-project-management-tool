import { beforeAll, describe, expect, it } from "vitest";
import { query, DbResult, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import { createLedProject, createUser } from "./helpers";
import {
  PROJECT_CREDITED_SQL,
  PROJECT_UNITS_SQL,
  projectPercent,
  projectUnitsOf,
} from "@/lib/progress";

/**
 * A project's completion is counted in checklist items, so a task whose
 * checklist is nearly all ticked counts for nearly all of it.
 *
 * The same sum exists twice — once in SQL for the lists that never load a
 * project's tasks, once in TypeScript for the board that already has them.
 * These tests exist so the two cannot drift apart.
 */
describe("project completion", () => {
  let lead: User;
  let projectId: number;

  async function addTask(
    status: string,
    checklist: boolean[]
  ): Promise<void> {
    const res = (await query<DbResult>(
      `INSERT INTO tasks (project_id, title, status, assignee_id)
       VALUES (?, ?, ?, ?)`,
      [projectId, `Task ${status} ${checklist.length}`, status, lead.id]
    )) as unknown as DbResult;
    for (const done of checklist) {
      await query(
        `INSERT INTO subtasks (task_id, title, is_done) VALUES (?, 'item', ?)`,
        [res.insertId, done ? 1 : 0]
      );
    }
  }

  beforeAll(async () => {
    lead = await createUser("ProgressLead");
    projectId = await createLedProject(lead, "Progress project");
    // 4 items, 3 ticked.
    await addTask("in_progress", [true, true, true, false]);
    // Done counts in full even though one item is unticked.
    await addTask("done", [true, false]);
    // No checklist: one unit, unearned until it is Done.
    await addTask("todo", []);
  });

  it("counts ticked items, not whole tasks", async () => {
    const rows = await query<DbRow[]>(
      `SELECT ${PROJECT_UNITS_SQL} AS units, ${PROJECT_CREDITED_SQL} AS credited
         FROM projects p WHERE p.id = ?`,
      [projectId]
    );
    const units = Number(rows[0].units);
    const credited = Number(rows[0].credited);

    // 4 + 2 + 1 units; 3 ticked + 2 (the Done task in full) + 0.
    expect(units).toBe(7);
    expect(credited).toBe(5);
    expect(projectPercent({ units, credited })).toBe(71);

    // Counting whole tasks would have called this project a third done.
    expect(Math.round((1 / 3) * 100)).toBe(33);
  });

  it("agrees with the figure the project board works out for itself", async () => {
    const tasks = await query<DbRow[]>(
      `SELECT t.status,
              (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
              (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.is_done)
                AS subtask_done
         FROM tasks t WHERE t.project_id = ?`,
      [projectId]
    );
    const inBrowser = projectUnitsOf(
      tasks.map((t) => ({
        status: t.status,
        subtask_total: Number(t.subtask_total),
        subtask_done: Number(t.subtask_done),
      }))
    );

    const rows = await query<DbRow[]>(
      `SELECT ${PROJECT_UNITS_SQL} AS units, ${PROJECT_CREDITED_SQL} AS credited
         FROM projects p WHERE p.id = ?`,
      [projectId]
    );
    expect(inBrowser.units).toBe(Number(rows[0].units));
    expect(inBrowser.credited).toBe(Number(rows[0].credited));
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
