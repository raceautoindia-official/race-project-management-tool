import { NextRequest } from "next/server";
import { query, DbResult } from "@/lib/db";
import { fetchTaskRequests } from "@/lib/tasks";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import {
  assertProjectAccess,
  assertProjectWritable,
  canManageProject,
} from "@/lib/rbac";
import { createTaskRequestSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { projectAlertRecipients } from "@/lib/recipients";
import { sendEmail, emailLayout, appBaseUrl, escapeHtml } from "@/lib/mailer";
import { normalizeSpec, SPEC_KEYS, specFromBody } from "@/lib/workflow";

type Params = { params: Promise<{ id: string }> };

/**
 * GET — task requests for a project. Admins/leads see every request; other
 * members see the ones they raised. Pending first, then most recent.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    const { projectRole } = await assertProjectAccess(user, projectId);
    const manager = canManageProject(user, projectRole);

    const requests = await fetchTaskRequests(
      `r.project_id = ? ${manager ? "" : "AND r.requested_by = ?"}`,
      manager ? [projectId] : [projectId, user.id]
    );
    return json({ requests });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST — any project member raises a correction / new-feature request. */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    const { project } = await assertProjectAccess(user, projectId);
    assertProjectWritable(project);

    const data = createTaskRequestSchema.parse(await req.json().catch(() => ({})));
    const spec = normalizeSpec(data.taskType, specFromBody(data));

    const result = (await query<DbResult>(
      // INSERT … SELECT re-checks the project is still open (it may have been
      // completed since the check above).
      `INSERT INTO task_requests
         (project_id, task_type, title, ${SPEC_KEYS.join(", ")},
          priority, estimated_hours, start_date, due_date,
          status, requested_by, requested_at)
       SELECT ?, ?, ?, ${SPEC_KEYS.map(() => "?").join(", ")}, ?, ?, ?, ?,
              'pending', ?, UTC_TIMESTAMP()
         FROM projects
        WHERE id = ? AND approval_status = 'approved' AND status <> 'completed'`,
      [
        projectId,
        data.taskType,
        data.title,
        ...SPEC_KEYS.map((k) => spec[k]),
        data.priority ?? "medium",
        data.estimatedHours ?? null,
        data.startDate ?? null,
        data.dueDate ?? null,
        user.id,
        projectId,
      ]
    )) as unknown as DbResult;
    if (result.affectedRows === 0) {
      throw new ApiError(409, "This project is read-only — the request wasn't raised.");
    }

    await logActivity({
      userId: user.id,
      action: "task_request.raised",
      entityType: "project",
      entityId: projectId,
      metadata: { requestId: result.insertId, title: data.title, type: data.taskType },
    });

    const link = `/projects/${projectId}`;
    const recipients = await projectAlertRecipients(projectId);
    for (const r of recipients.filter((r) => r.id !== user.id)) {
      await notify(
        r.id,
        "task_request_raised",
        `${user.name} raised "${data.title}" in ${project.name} — awaiting approval`,
        link
      );
      await sendEmail({
        to: [r.email],
        subject: `Task request awaiting approval: ${data.title}`,
        html: emailLayout(
          "Task request awaiting approval",
          `<p><strong>${escapeHtml(user.name)}</strong> raised <strong>${escapeHtml(data.title)}</strong> in <strong>${escapeHtml(project.name)}</strong>.</p>
           <p><a href="${appBaseUrl()}${link}">Review the request →</a></p>`
        ),
      });
    }

    const [request] = await fetchTaskRequests("r.id = ?", [result.insertId]);
    return json({ request }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
