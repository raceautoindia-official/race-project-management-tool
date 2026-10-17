// Dev helper: apply a migration to a database and compare its columns,
// indexes and foreign keys with a fresh install from db/schema.sql.
//   node scripts/compare-schemas.mjs <db> [migration.sql ...]
// Uses MYSQL_* from .env.local. Creates and drops a scratch "pm_schema_ref".
import fs from "node:fs";
import mysql from "mysql2/promise";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);
const [db, ...migrations] = process.argv.slice(2);
if (!db || db === env.MYSQL_DATABASE) {
  console.error("Refusing: pass a scratch database (not the one in .env.local).");
  process.exit(1);
}
const c = await mysql.createConnection({
  host: env.MYSQL_HOST, port: +(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, multipleStatements: true,
});
for (const m of migrations) {
  await c.query(`USE \`${db}\`; ${fs.readFileSync(m, "utf8")}`);
  console.log("applied", m);
}
await c.query("DROP DATABASE IF EXISTS pm_schema_ref; CREATE DATABASE pm_schema_ref CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
const schema = fs.readFileSync("db/schema.sql", "utf8")
  .replace(/CREATE DATABASE[\s\S]*?;\s*/i, "").replace(/USE\s+\w+;\s*/i, "");
await c.query(`USE pm_schema_ref; ${schema}`);

async function shape(name) {
  const [cols] = await c.query(
    `SELECT table_name t, column_name n, column_type ty, is_nullable nu, column_default d
       FROM information_schema.columns WHERE table_schema=? ORDER BY 1,2`, [name]);
  const [fks] = await c.query(
    `SELECT table_name t, constraint_name n, referenced_table_name r
       FROM information_schema.referential_constraints
      WHERE constraint_schema=? ORDER BY 1,2`, [name]);
  return {
    cols: new Set(cols.map((r) => `${r.t}.${r.n} ${r.ty} ${r.nu} ${r.d}`)),
    fks: new Set(fks.map((r) => `${r.t}.${r.n}->${r.r}`)),
  };
}
const a = await shape(db), b = await shape("pm_schema_ref");
let diffs = 0;
for (const k of ["cols", "fks"]) {
  for (const x of b[k]) if (!a[k].has(x)) { diffs++; console.log(`missing in ${db}:`, x); }
  for (const x of a[k]) if (!b[k].has(x)) { diffs++; console.log(`extra in ${db}:  `, x); }
}
console.log(diffs ? `${diffs} differences` : "IDENTICAL columns and foreign keys");
await c.query("DROP DATABASE pm_schema_ref");
await c.end();
