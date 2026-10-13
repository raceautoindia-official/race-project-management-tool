import { describe, expect, it } from "vitest";
import { parseTasksWorkbook, tasksWorkbookBuffer, templateWorkbookBuffer } from "@/lib/excel";

// Guards the Excel export/import (exceljs runs with an overridden uuid version).
describe("Excel export → import round trip", () => {
  it("reads back what it wrote", async () => {
    const buffer = await tasksWorkbookBuffer([
      {
        title: "Fix invoice totals",
        description: "Rounds down",
        status: "in_progress",
        priority: "high",
        assignee_emp_id: "RACE005",
        due_date: "2026-10-01",
        estimated_hours: 4,
      },
    ]);
    const rows = await parseTasksWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Fix invoice totals",
      description: "Rounds down",
      status: "in_progress",
      priority: "high",
      assigneeEmpId: "RACE005",
      dueDate: "2026-10-01",
      estimatedHours: 4,
    });
  });

  it("builds the import template", async () => {
    const buffer = await templateWorkbookBuffer([{ empId: "RACE005", name: "Arun" }]);
    expect(buffer.subarray(0, 2).toString()).toBe("PK"); // a zip (xlsx) file
  });
});
