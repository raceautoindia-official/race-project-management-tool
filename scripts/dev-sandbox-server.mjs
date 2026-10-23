// Starts `next dev` on port 3100 for the local sandbox (scripts/dev-sandbox.mjs).
// The test attendance DB was created with the main DB login, so the attendance
// connection reuses it — passed in the process environment (which wins over
// env files) rather than copied into another file.
import fs from "node:fs";
import { spawn } from "node:child_process";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", "3100"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ATTENDANCE_DB_HOST: env.MYSQL_HOST,
    ATTENDANCE_DB_PORT: env.MYSQL_PORT ?? "3306",
    ATTENDANCE_DB_USER: env.MYSQL_USER,
    ATTENDANCE_DB_PASSWORD: env.MYSQL_PASSWORD,
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
