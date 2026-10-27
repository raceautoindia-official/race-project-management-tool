import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { createSchemaDatabase, serverConnection } from "./db";

/**
 * Migrations that shape the tables compared below, in the order a deployment
 * applies them. A new migration that adds a column to projects, tasks or
 * task_requests belongs here, or "same columns as a fresh install" fails —
 * which is the point: schema.sql and the migrations must not drift apart.
 */
const LATER_MIGRATIONS = [
  "2026-09-25_request_priority_and_time.sql",
  "2026-09-26_request_start_date.sql",
  "2026-09-26_meeting_invite_delivery.sql",
  "2026-09-30_subtask_source.sql",
  "2026-09-30_blocker_requests.sql",
  "2026-10-08_credentials.sql",
  "2026-10-08_credential_sharing.sql",
  "2026-10-08_personal_documents.sql",
  "2026-10-08_planner.sql",
  "2026-10-10_credential_fields.sql",
  "2026-10-17_redesign_fundamentals.sql",
  "2026-10-27_quick_requests.sql",
].map((f) =>
  readFileSync(new URL(`../../db/migrations/${f}`, import.meta.url), "utf8")
);

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
    ALTER TABLE meetings DROP COLUMN invite_sent_at;
    ALTER TABLE subtasks DROP COLUMN source;
    ALTER TABLE task_dependencies
      DROP FOREIGN KEY fk_dep_requester, DROP FOREIGN KEY fk_dep_decider;
    ALTER TABLE task_dependencies
      DROP COLUMN status, DROP COLUMN reason, DROP COLUMN requested_by,
      DROP COLUMN decided_by, DROP COLUMN decided_at;
    DROP TABLE planner_entries;
    DROP TABLE user_documents;
    DROP TABLE credential_views;
    DROP TABLE credential_access;
    DROP TABLE credentials;

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
    // Bring the migrated database up to date, as a real deployment would,
    // before comparing it with a fresh install.
    for (const sql of LATER_MIGRATIONS) await conn.query(`USE pm_migrate; ${sql}`);

    for (const table of [
      "projects",
      "tasks",
      "task_requests",
      "meetings",
      "subtasks",
      "task_dependencies",
      "credentials",
      "credential_views",
      "credential_access",
      "user_documents",
      "planner_entries",
      "task_comments",
      "task_attachments",
      "designation_levels",
    ]) {
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

describe("2026-10-17 redesign fundamentals", () => {
  const REDESIGN = readFileSync(
    new URL("../../db/migrations/2026-10-17_redesign_fundamentals.sql", import.meta.url),
    "utf8"
  );

  beforeAll(async () => {
    // A current install rolled back to the shape before the redesign, with
    // the kind of data production has: ticked and unticked checklist items,
    // a project whose tasks started before it was created, a job title.
    await createSchemaDatabase(config, "pm_redesign");
    await conn.query(`
      USE pm_redesign;
      ALTER TABLE task_comments DROP FOREIGN KEY fk_comments_subtask;
      ALTER TABLE task_comments DROP INDEX idx_comments_subtask, DROP COLUMN subtask_id;
      ALTER TABLE task_attachments DROP FOREIGN KEY fk_att_subtask;
      ALTER TABLE task_attachments DROP INDEX idx_att_subtask, DROP COLUMN subtask_id;
      ALTER TABLE subtasks
        DROP FOREIGN KEY fk_subtasks_assignee, DROP FOREIGN KEY fk_subtasks_approver,
        DROP FOREIGN KEY fk_subtasks_creator;
      ALTER TABLE subtasks
        DROP INDEX idx_subtasks_assignee, DROP INDEX idx_subtasks_due,
        DROP COLUMN description, DROP COLUMN assignee_id, DROP COLUMN status,
        DROP COLUMN start_date, DROP COLUMN due_date, DROP COLUMN due_alert_sent, DROP COLUMN weight,
        DROP COLUMN weight_mode, DROP COLUMN submitted_at, DROP COLUMN approved_by,
        DROP COLUMN approved_at, DROP COLUMN changes_requested, DROP COLUMN created_by,
        DROP COLUMN updated_at;
      ALTER TABLE tasks DROP COLUMN weight, DROP COLUMN weight_mode, DROP COLUMN position;
      ALTER TABLE projects DROP COLUMN start_date, DROP COLUMN due_date;
      DROP TABLE designation_levels;

      INSERT INTO users (id, employee_id, emp_id, name, designation) VALUES
        (1, 1, 'E1', 'Owner', 'Manager'), (2, 2, 'E2', 'Doer', ' Executive '), (3, 3, 'E3', 'New', NULL);
      INSERT INTO projects (id, name, owner_id, created_at) VALUES
        (1, 'Dated', 1, '2026-09-10 08:00:00'), (2, 'Empty', 1, '2026-09-12 08:00:00');
      INSERT INTO tasks (id, project_id, title, assignee_id, start_date, due_date, created_at) VALUES
        (1, 1, 'Second made', 2, '2026-09-01', '2026-09-20', '2026-09-11 09:00:00'),
        (2, 1, 'First made',  2, NULL,         '2026-10-05', '2026-09-10 09:00:00'),
        (3, 1, 'Nobody owns', NULL, NULL, NULL, '2026-09-12 09:00:00');
      INSERT INTO subtasks (id, task_id, title, is_done, position) VALUES
        (1, 1, 'Ticked', 1, 0), (2, 1, 'Open', 0, 1), (3, 3, 'Orphan', 1, 0);
    `);
  });

  afterAll(async () => {
    await conn.query("DROP DATABASE IF EXISTS pm_redesign");
  });

  it("gives checklist items to the task owner and approves the ticked ones", async () => {
    await conn.query(`USE pm_redesign; ${REDESIGN}`);
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, assignee_id, status, is_done, approved_by, approved_at IS NOT NULL AS stamped FROM pm_redesign.subtasks ORDER BY id"
    );
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { id: 1, assignee_id: 2, status: "done", is_done: 1, approved_by: 2, stamped: 1 },
      { id: 2, assignee_id: 2, status: "todo", is_done: 0, approved_by: null, stamped: 0 },
      // A task with no owner leaves its items unassigned (still approved if ticked).
      { id: 3, assignee_id: null, status: "done", is_done: 1, approved_by: null, stamped: 1 },
    ]);
  });

  it("dates projects from their tasks and keeps the task order", async () => {
    const [projects] = await conn.query<RowDataPacket[]>(
      "SELECT id, start_date, due_date FROM pm_redesign.projects ORDER BY id"
    );
    expect(projects.map((r) => ({ ...r }))).toEqual([
      { id: 1, start_date: "2026-09-01", due_date: "2026-10-05" },
      { id: 2, start_date: "2026-09-12", due_date: null },
    ]);
    const [tasks] = await conn.query<RowDataPacket[]>(
      "SELECT id, position, weight_mode FROM pm_redesign.tasks ORDER BY position"
    );
    expect(tasks.map((r) => ({ ...r }))).toEqual([
      { id: 2, position: 0, weight_mode: "auto" },
      { id: 1, position: 1, weight_mode: "auto" },
      { id: 3, position: 2, weight_mode: "auto" },
    ]);
  });

  it("lists the job titles already in use, without a level yet", async () => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT title, level FROM pm_redesign.designation_levels ORDER BY title"
    );
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { title: "Executive", level: null },
      { title: "Manager", level: null },
    ]);
  });

  it("is safe to re-run and does not redo the backfill", async () => {
    await conn.query("UPDATE pm_redesign.subtasks SET assignee_id = 1 WHERE id = 2");
    await conn.query("UPDATE pm_redesign.projects SET due_date = NULL WHERE id = 1");
    await expect(conn.query(`USE pm_redesign; ${REDESIGN}`)).resolves.toBeDefined();
    const [[s]] = await conn.query<RowDataPacket[]>("SELECT assignee_id FROM pm_redesign.subtasks WHERE id = 2");
    expect(s.assignee_id).toBe(1);
    const [[p]] = await conn.query<RowDataPacket[]>("SELECT due_date FROM pm_redesign.projects WHERE id = 1");
    expect(p.due_date).toBeNull();
  });

  it("ends with the same columns as a fresh install", async () => {
    for (const table of ["subtasks", "tasks", "projects", "task_comments", "task_attachments", "designation_levels"]) {
      expect({ table, columns: await columns("pm_redesign", table) }).toEqual({
        table,
        columns: await columns("pm_fresh", table),
      });
    }
  });
});
