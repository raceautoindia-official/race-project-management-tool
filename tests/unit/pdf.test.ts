import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildTaskPdf, type TaskPdfData } from "@/lib/pdf";
import type { Task } from "@/lib/types";

function sampleTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 42,
    project_id: 7,
    project_name: "Customer portal",
    title: "Invoice totals round down",
    description: null,
    task_type: "correction",
    existing_behavior: "Totals are truncated to 2 decimals.",
    expected_behavior: "Totals round half-up.",
    acceptance_criteria: "12.345 shows as 12.35\n12.344 shows as 12.34",
    reason: null,
    scope: "Invoices only",
    status: "done",
    priority: "high",
    estimated_hours: 4,
    spent_hours: 3.5,
    assignee_id: 4,
    assignee_name: "Sam",
    created_by: 2,
    creator_name: "Lee",
    requested_by: 3,
    requester_name: "Alex",
    requested_at: "2026-09-10 04:30:00",
    request_approved_by: 2,
    request_approver_name: "Lee",
    request_approved_at: "2026-09-10 05:00:00",
    completed_at: "2026-09-15 09:00:00",
    signed_off_by: 3,
    signer_name: "Alex",
    signed_off_at: "2026-09-16 06:15:00",
    signoff_note: "Verified on staging",
    due_date: "2026-09-20",
    start_date: "2026-09-11",
    created_at: "2026-09-10 04:30:00",
    updated_at: "2026-09-16 06:15:00",
    labels: [{ id: 1, project_id: 7, name: "billing", color: "amber" }],
    ...overrides,
  };
}

function data(overrides: Partial<TaskPdfData> = {}): TaskPdfData {
  return {
    task: sampleTask(),
    subtasks: [
      { title: "Fix rounding helper", is_done: true },
      { title: "Add regression test", is_done: false },
    ],
    comments: [{ user_name: "Sam", body: "Deployed to staging.", created_at: "2026-09-15 08:00:00" }],
    attachments: [{ filename: "before-after.png", size_bytes: 20480, uploader_name: "Sam" }],
    loggedMinutes: 210,
    generatedBy: "Lee",
    generatedAt: new Date("2026-09-17T06:00:00Z"),
    ...overrides,
  };
}

describe("buildTaskPdf", () => {
  it("produces a valid PDF with task metadata", async () => {
    const bytes = await buildTaskPdf(data());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe("Task #42 — Invoice totals round down");
    expect(doc.getAuthor()).toBe("Lee");
  });

  it("survives characters outside the standard PDF font (₹, arrows, CJK, emoji)", async () => {
    const bytes = await buildTaskPdf(
      data({
        task: sampleTask({
          title: "Price ₹1,200 → ₹1,500 ✓ 价格 🚀",
          existing_behavior: "Tab\tseparated — “quoted” • bullet… ₹",
          signed_off_at: null,
          task_type: "feature",
          features: "தமிழ் text",
          flow: null,
          rules: "≥ 2 approvals",
        }),
      })
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("paginates long content", async () => {
    const long = Array.from({ length: 400 }, (_, i) => `Line ${i + 1} of a very long acceptance criteria list.`).join("\n");
    const bytes = await buildTaskPdf(
      data({
        task: sampleTask({ acceptance_criteria: long }),
        comments: Array.from({ length: 40 }, (_, i) => ({
          user_name: "Sam",
          body: `Comment ${i} ${"word ".repeat(60)}${"x".repeat(300)}`,
          created_at: "2026-09-15 08:00:00",
        })),
      })
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(3);
  });

  it("renders legacy general tasks with a description", async () => {
    const bytes = await buildTaskPdf(
      data({
        task: sampleTask({
          task_type: "general",
          description: "Imported from Excel",
          requested_by: null,
          requester_name: null,
          signed_off_at: null,
        }),
        subtasks: [],
        comments: [],
        attachments: [],
      })
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
