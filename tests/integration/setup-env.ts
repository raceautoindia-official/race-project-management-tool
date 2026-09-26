import { afterAll, inject, vi } from "vitest";

// Point lib/db at the test database before any route module creates the pool.
const c = inject("mysql");
process.env.MYSQL_HOST = c.host;
process.env.MYSQL_PORT = String(c.port);
process.env.MYSQL_USER = c.user;
process.env.MYSQL_PASSWORD = c.password;
process.env.MYSQL_DATABASE = c.database;

// Sessions come from a cookie in the app; tests pick the user via actAs().
vi.mock("@/lib/auth", async () => {
  const { ApiError } = await import("@/lib/http");
  const current = () => (globalThis as { __testUser?: unknown }).__testUser ?? null;
  return {
    ApiError,
    getCurrentUser: async () => current(),
    requireUser: async () => {
      const user = current();
      if (!user) throw new ApiError(401, "Not authenticated");
      return user;
    },
    requireAdmin: async () => {
      const user = current() as { role?: string } | null;
      if (!user) throw new ApiError(401, "Not authenticated");
      if (user.role !== "admin") throw new ApiError(403, "Admin access required");
      return user;
    },
  };
});

// No outbound email in tests (templates and escaping stay real).
// These are vi.fn()s so a test that cares — one checking what changes when
// email *is* switched on — can override them for its own duration.
vi.mock("@/lib/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mailer")>()),
  mailerConfigured: vi.fn(() => false),
  sendEmail: vi.fn(async () => false),
  sendCalendarInvite: vi.fn(async () => false),
}));

afterAll(async () => {
  const { pool } = await import("@/lib/db");
  await pool.end();
  delete (globalThis as { __pmPool?: unknown }).__pmPool;
});
