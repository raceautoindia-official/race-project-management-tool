import { afterEach, describe, expect, it, vi } from "vitest";
import { emailLayout, escapeHtml } from "@/lib/mailer";
import { toCsv } from "@/lib/csv";
import { safeNextPath } from "@/lib/safe-redirect";
import { ACCOUNT_MAX_ATTEMPTS, checkRateLimit, clearRateLimit } from "@/lib/ratelimit";
import { buildTaskPdf } from "@/lib/pdf";
import { signOffBlockers } from "@/lib/workflow";
import type { Task } from "@/lib/types";

describe("email HTML escaping", () => {
  it("escapes user text and the title", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;"
    );
    expect(escapeHtml(null)).toBe("");
    expect(emailLayout("<b>Hi</b>", "<p>ok</p>")).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(emailLayout("t", "<p>ok</p>")).toContain("<p>ok</p>");
  });
});

describe("CSV formula neutralization", () => {
  it("prefixes text cells that would run as formulas", () => {
    const csv = toCsv(["a", "b", "c", "d", "e"], [["=1+1", "+x", "-y", "@z", "plain"], [-5, 3, "", null, "a=b"]]);
    const [, row1, row2] = csv.split("\r\n");
    expect(row1).toBe("'=1+1,'+x,'-y,'@z,plain");
    // Numbers (including negatives) and text not starting with a trigger are untouched.
    expect(row2).toBe("-5,3,,,a=b");
  });
});

describe("post-login redirect", () => {
  it("allows same-site paths only", () => {
    expect(safeNextPath("/projects/8")).toBe("/projects/8");
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example/login")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
  });
});

describe("login rate limit", () => {
  it("caps attempts per account regardless of the client", () => {
    const key = `login-account:TEST${Date.now()}`;
    for (let i = 0; i < ACCOUNT_MAX_ATTEMPTS; i++) {
      expect(checkRateLimit(key, ACCOUNT_MAX_ATTEMPTS).ok).toBe(true);
    }
    const blocked = checkRateLimit(key, ACCOUNT_MAX_ATTEMPTS);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    clearRateLimit(key);
    expect(checkRateLimit(key, ACCOUNT_MAX_ATTEMPTS).ok).toBe(true);
  });
});

describe("sign-off blockers", () => {
  const done = { status: "done" as const, requested_by: 1, request_approved_by: null, assignee_id: 2 };
  it("a missing approver blocks the requester but not a lead", () => {
    expect(signOffBlockers(done)).toEqual(["Approved by is missing — a project lead can sign it off"]);
    expect(signOffBlockers(done, { signerIsManager: true })).toEqual([]);
  });
});

describe("PDF generation cost", () => {
  it("handles a maximum-length unbroken word quickly", async () => {
    const task = {
      id: 1, project_id: 1, title: "t", description: "y".repeat(5000), task_type: "general",
      status: "todo", priority: "low", estimated_hours: null, spent_hours: 0, assignee_id: null,
      created_by: null, due_date: null, created_at: "2026-09-17 00:00:00", updated_at: "",
    } as unknown as Task;
    const started = Date.now();
    await buildTaskPdf({
      task,
      subtasks: [],
      attachments: [],
      loggedMinutes: 0,
      generatedBy: "x",
      comments: Array.from({ length: 5 }, () => ({
        user_name: "a",
        body: "x".repeat(5000),
        created_at: "2026-09-17 00:00:00",
      })),
    });
    // Was ~25 s for a single such comment before the wrapping fix.
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("prints narrow and thin spaces as spaces, not '?'", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const task = {
      id: 2, project_id: 1, title: "2:00 pm meeting​", description: null, task_type: "general",
      status: "todo", priority: "low", estimated_hours: null, spent_hours: 0, assignee_id: null,
      created_by: null, due_date: null, created_at: "2026-09-17 00:00:00", updated_at: "",
    } as unknown as Task;
    const bytes = await buildTaskPdf({ task, subtasks: [], attachments: [], comments: [], loggedMinutes: 0, generatedBy: "x" });
    expect((await PDFDocument.load(bytes)).getTitle()).toContain("meeting");
  });
});

describe("a misconfigured APP_BASE_URL announces itself", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** Load a fresh copy, so the once-only warning has not already fired. */
  async function freshAppBaseUrl() {
    vi.resetModules();
    return (await import("@/lib/mailer")).appBaseUrl;
  }

  it("warns once in production when nothing outside can reach it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const appBaseUrl = await freshAppBaseUrl();
    expect(appBaseUrl()).toBe("http://localhost:3000");
    appBaseUrl();
    appBaseUrl();

    // Once, not on every email.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("APP_BASE_URL");
  });

  it("stays quiet for a real public address, and in development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://pm.example.test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (await freshAppBaseUrl())();
    expect(warn).not.toHaveBeenCalled();

    // localhost is the right answer while developing, so no nagging.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    (await freshAppBaseUrl())();
    expect(warn).not.toHaveBeenCalled();
  });
});
