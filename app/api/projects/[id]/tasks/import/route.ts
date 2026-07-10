import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectManage } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import {
  parseTasksWorkbook,
  STATUS_VALUES,
  PRIORITY_VALUES,
} from "@/lib/excel";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

interface Issue {
  row: number;
  message: string;
  skipped: boolean;
}

/** POST /api/projects/:id/tasks/import — bulk-create tasks from an .xlsx. */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectManage(user, projectId);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) {
      throw new ApiError(400, "No file uploaded (expected form field 'file')");
    }
    const buffer = Buffer.from(await file.arrayBuffer());

    let rows;
    try {
      rows = await parseTasksWorkbook(buffer);
    } catch {
      throw new ApiError(400, "Could not read the spreadsheet — is it a .xlsx?");
    }
    if (rows.length === 0) {
      return json({ created: 0, issues: [], message: "No task rows found" });
    }
    if (rows.length > 1000) {
      throw new ApiError(400, "Too many rows (max 1000 per import)");
    }

    // Map project-member Employee IDs → user id for assignee resolution
    // (case-insensitive; every employee has an Employee ID).
    const members = await query<DbRow[]>(
      `SELECT u.id, UPPER(u.emp_id) AS emp_id FROM project_members pm
         JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?`,
      [projectId]
    );
    const empIdToId = new Map<string, number>(
      members.map((m) => [m.emp_id as string, m.id as number])
    );

    const issues: Issue[] = [];
    let created = 0;

    for (const r of rows) {
      // Status / priority validation.
      const status = r.status ?? "todo";
      if (!STATUS_VALUES.includes(status as (typeof STATUS_VALUES)[number])) {
        issues.push({ row: r.rowNumber, message: `Invalid status "${r.status}"`, skipped: true });
        continue;
      }
      const priority = r.priority ?? "medium";
      if (!PRIORITY_VALUES.includes(priority as (typeof PRIORITY_VALUES)[number])) {
        issues.push({ row: r.rowNumber, message: `Invalid priority "${r.priority}"`, skipped: true });
        continue;
      }

      // Assignee resolution (warning, not fatal).
      let assigneeId: number | null = null;
      if (r.assigneeEmpId) {
        const found = empIdToId.get(r.assigneeEmpId.toUpperCase());
        if (found) assigneeId = found;
        else
          issues.push({
            row: r.rowNumber,
            message: `Employee ID "${r.assigneeEmpId}" is not a project member — left unassigned`,
            skipped: false,
          });
      }

      // Due date (warning if malformed).
      let dueDate: string | null = null;
      if (r.dueDate === "invalid") {
        issues.push({ row: r.rowNumber, message: "Unrecognized due date — left blank", skipped: false });
      } else {
        dueDate = r.dueDate;
      }

      const estHours =
        r.estimatedHours != null && !Number.isNaN(r.estimatedHours)
          ? r.estimatedHours
          : null;

      await query<DbResult>(
        `INSERT INTO tasks
           (project_id, title, description, status, priority, estimated_hours,
            assignee_id, created_by, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          projectId,
          r.title.slice(0, 200),
          r.description,
          status,
          priority,
          estHours,
          assigneeId,
          user.id,
          dueDate,
        ]
      );
      created++;
    }

    await logActivity({
      userId: user.id,
      action: "tasks.imported",
      entityType: "project",
      entityId: projectId,
      metadata: { created, issues: issues.length },
    });

    return json({ created, issues });
  } catch (err) {
    return errorResponse(err);
  }
}
