import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { createSchemaDatabase, serverConnection } from "./db";

const MIGRATION = readFileSync(
  new URL("../../db/migrations/2026-09-17_phase4_requests_signoff.sql", import.meta.url),
  "utf8"
);

const config = inject("mysql");
let conn: Connection;

async function columns(db: string, table: string) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT column_name AS name, column_type AS type, is_nullable AS nullable,
            column_default AS dflt
       FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY column_name`,
    [db, table]
  );
  return rows.map((r) => ({ ...r }));
}

beforeAll(async () => {
  // A fresh reference schema, and a copy rolled back to the pre-phase-4 shape.
  await createSchemaDatabase(config, "pm_fresh");
  await createSchemaDatabase(config, "pm_migrate");
  conn = await serverConnection(config);
  await conn.query(`
    USE pm_migrate;
    DROP TABLE task_requests;
    ALTER TABLE tasks
      DROP FOREIGN KEY fk_tasks_requester,
      DROP FOREIGN KEY fk_tasks_req_approver,
      DROP FOREIGN KEY fk_tasks_signer;
    ALTER TABLE tasks
      DROP INDEX idx_tasks_signed_off, DROP INDEX idx_tasks_request,
      DROP COLUMN task_type, DROP COLUMN existing_behavior, DROP COLUMN expected_behavior,
      DROP COLUMN acceptance_criteria, DROP COLUMN reason, DROP COLUMN scope,
      DROP COLUMN features, DROP COLUMN flow, DROP COLUMN rules,
      DROP COLUMN request_id, DROP COLUMN requested_by, DROP COLUMN request_approved_by,
      DROP COLUMN request_approved_at, DROP COLUMN signed_off_by, DROP COLUMN signed_off_at,
      DROP COLUMN signoff_note;
    ALTER TABLE projects
      DROP FOREIGN KEY fk_projects_requester,
      DROP FOREIGN KEY fk_projects_decider;
    ALTER TABLE projects
      DROP INDEX idx_projects_approval,
      DROP COLUMN approval_status, DROP COLUMN requested_by, DROP COLUMN requested_at,
      DROP COLUMN decided_by, DROP COLUMN decided_at, DROP COLUMN decision_note;

    INSERT INTO users (id, employee_id, emp_id, name, role) VALUES
      (1, 1, 'E1', 'Owner', 'admin'), (2, 2, 'E2', 'Creator', 'member');
    INSERT INTO projects (id, name, owner_id) VALUES (1, 'Legacy', 1);
    INSERT INTO tasks (id, project_id, title, created_by) VALUES
      (1, 1, 'Made by a lead', 2), (2, 1, 'Creator since deleted', NULL);
  `);
});

afterAll(async () => {
  await conn.query(`DROP DATABASE IF EXISTS pm_fresh; DROP DATABASE IF EXISTS pm_migrate;`);
  await conn.end();
});

describe("2026-09-17 phase 4 migration", () => {
  it("upgrades an existing database and backfills the approval trail", async () => {
    await conn.query(`USE pm_migrate; ${MIGRATION}`);

    const [tasks] = await conn.query<RowDataPacket[]>(
      `SELECT id, task_type, requested_by, request_approved_by, request_approved_at IS NOT NULL AS stamped,
              signed_off_at
         FROM pm_migrate.tasks ORDER BY id`
    );
    expect(tasks.map((t) => ({ ...t }))).toEqual([
      { id: 1, task_type: "general", requested_by: 2, request_approved_by: 2, stamped: 1, signed_off_at: null },
      // No creator → the project owner is recorded.
      { id: 2, task_type: "general", requested_by: 1, request_approved_by: 1, stamped: 1, signed_off_at: null },
    ]);
    const [[p]] = await conn.query<RowDataPacket[]>(
      `SELECT approval_status FROM pm_migrate.projects WHERE id = 1`
    );
    expect(p.approval_status).toBe("approved");

    // The tasks were created just now; the backfilled approval time must be
    // stored in UTC (like every other *_at DATETIME), whatever the server's
    // time zone — the app formats it as UTC.
    const [[drift]] = await conn.query<RowDataPacket[]>(
      `SELECT MAX(ABS(TIMESTAMPDIFF(SECOND, request_approved_at, UTC_TIMESTAMP()))) AS seconds
         FROM pm_migrate.tasks`
    );
    expect(Number(drift.seconds)).toBeLessThan(120);
  });

  it("is safe to re-run", async () => {
    await expect(conn.query(`USE pm_migrate; ${MIGRATION}`)).resolves.toBeDefined();
  });

  it("produces the same columns as a fresh schema.sql install", async () => {
    for (const table of ["projects", "tasks", "task_requests"]) {
      expect({ table, columns: await columns("pm_migrate", table) }).toEqual({
        table,
        columns: await columns("pm_fresh", table),
      });
    }
  });
});

describe("2026-09-18 legacy completion-time fix", () => {
  const FIX = readFileSync(
    new URL("../../db/migrations/2026-09-18_fix_legacy_completed_at.sql", import.meta.url),
    "utf8"
  );

  it("shifts only the backfilled times, once, and leaves the rest alone", async () => {
    await createSchemaDatabase(config, "pm_times");
    // A task completed by the app (approved, so already UTC), and one whose
    // time the July backfill copied from updated_at in the server's time zone.
    await conn.query(`
      USE pm_times;
      INSERT INTO users (id, employee_id, emp_id, name) VALUES (1, 1, 'E1', 'Lee');
      INSERT INTO projects (id, name, owner_id) VALUES (1, 'Legacy', 1);
      INSERT INTO tasks (id, project_id, title, status, approved_by, approved_at, completed_at)
        VALUES (1, 1, 'Approved in the app', 'done', 1, '2026-07-08 10:29:25', '2026-07-08 10:29:25');
      INSERT INTO tasks (id, project_id, title, status, completed_at)
        VALUES (2, 1, 'Backfilled from updated_at', 'done', '2026-07-08 15:59:25');
      INSERT INTO tasks (id, project_id, title, status) VALUES (3, 1, 'Still open', 'todo');
    `);

    const [[{ offset }]] = await conn.query<RowDataPacket[]>(
      `SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset`
    );
    const shifted = (t: string, by: number) =>
      new Date(new Date(`${t.replace(" ", "T")}Z`).getTime() - by * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

    await conn.query(`USE pm_times; ${FIX}`);
    const read = async () =>
      (
        await conn.query<RowDataPacket[]>(
          `SELECT id, DATE_FORMAT(completed_at, '%Y-%m-%d %H:%i:%s') AS completed
             FROM pm_times.tasks ORDER BY id`
        )
      )[0].map((r) => ({ ...r }));

    const after = await read();
    expect(after).toEqual([
      { id: 1, completed: "2026-07-08 10:29:25" }, // untouched
      { id: 2, completed: shifted("2026-07-08 15:59:25", Number(offset)) },
      { id: 3, completed: null },
    ]);

    // Running it again must not shift anything a second time.
    await conn.query(`USE pm_times; ${FIX}`);
    expect(await read()).toEqual(after);
    await conn.query(`DROP DATABASE pm_times`);
  });
});
