/**
 * Backfill checklists from specifications. Run with: npm run backfill:checklists
 *
 * A task created from now on gets its checklist seeded from its own spec
 * (expected behaviour + acceptance criteria, or features + rules). This brings
 * the tasks that came before up to the same state, in one pass, so nobody has
 * to open each one.
 *
 * It only ever adds. An item already on a checklist is left exactly as it is,
 * ticked or not, and a signed-off (read-only) task is never touched.
 *
 *   node scripts/backfill-checklists.mjs --dry-run   # show what it would add
 *   node scripts/backfill-checklists.mjs             # add it
 */
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}

// Mirrors checklistFromSpec() in lib/workflow.ts — a Node script can't import
// the TypeScript module. tests/unit/backfill-checklists.test.ts asserts the two
// agree, so they can't drift apart unnoticed.
const CHECKLIST_SOURCES = {
  correction: ["expected_behavior", "acceptance_criteria"],
  feature: ["features", "rules"],
};
const MAX_CHECKLIST_ITEMS = 50;

export function checklistItems(type, spec) {
  const keys = CHECKLIST_SOURCES[type] ?? [];
  const items = [];
  const seen = new Set();
  for (const key of keys) {
    const lines = String(spec[key] ?? "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*•‣▪]|\d+[.)])\s+/, "").trim())
      .filter((line) => line.length > 0)
      .map((line) => line.slice(0, 255));
    for (const line of lines) {
      const fingerprint = line.toLowerCase();
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      items.push(line);
      if (items.length >= MAX_CHECKLIST_ITEMS) return items;
    }
  }
  return items;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  loadEnv(".env.local");
  loadEnv(".env");

  const db = await mysql.createConnection({
    host: process.env.MYSQL_HOST ?? "localhost",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "pm_app",
  });

  const [tasks] = await db.execute(
    `SELECT id, title, task_type, signed_off_at,
            expected_behavior, acceptance_criteria, features, rules
       FROM tasks
      WHERE task_type IN ('correction', 'feature')
      ORDER BY id ASC`
  );

  let touched = 0;
  let added = 0;
  let lockedSkipped = 0;

  for (const task of tasks) {
    const wanted = checklistItems(task.task_type, task);
    if (!wanted.length) continue;

    const [existing] = await db.execute(
      `SELECT title FROM subtasks WHERE task_id = ?`,
      [task.id]
    );
    const have = new Set(existing.map((r) => String(r.title).trim().toLowerCase()));
    const pending = wanted
      .filter((item) => !have.has(item.toLowerCase()))
      .slice(0, Math.max(0, MAX_CHECKLIST_ITEMS - existing.length));
    if (!pending.length) continue;

    if (task.signed_off_at) {
      // Signed off means read-only in the app; the script honours that.
      lockedSkipped += 1;
      console.log(`  skip #${task.id} ${task.title} — signed off (${pending.length} item(s) not added)`);
      continue;
    }

    console.log(`  #${task.id} ${task.title} — ${pending.length} item(s)`);
    for (const item of pending) console.log(`      + ${item}`);

    if (!dryRun) {
      const [[{ nextPos }]] = await db.execute(
        `SELECT COALESCE(MAX(position) + 1, 0) AS nextPos FROM subtasks WHERE task_id = ?`,
        [task.id]
      );
      await db.execute(
        `INSERT INTO subtasks (task_id, title, position) VALUES ${pending
          .map(() => "(?, ?, ?)")
          .join(", ")}`,
        pending.flatMap((title, i) => [task.id, title, Number(nextPos) + i])
      );
    }
    touched += 1;
    added += pending.length;
  }

  console.log(
    dryRun
      ? `\nWould add ${added} checklist item(s) across ${touched} task(s). Re-run without --dry-run to apply.`
      : `\nAdded ${added} checklist item(s) across ${touched} task(s).`
  );
  if (lockedSkipped) {
    console.log(`${lockedSkipped} signed-off task(s) left untouched.`);
  }
  await db.end();
}

// Importable for its parser (the test), runnable as a script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
