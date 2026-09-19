import { pool, query, DbRow } from "./db";
import type { Label } from "./types";

/**
 * SQL converting a TIMESTAMP column (returned in the session time zone) to UTC,
 * matching the DATETIME columns written with UTC_TIMESTAMP().
 */
export function utcSql(column: string): string {
  return `DATE_SUB(${column}, INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND)`;
}

/** Every column of a full task row, incl. spec + approval trail (see TASK_JOINS). */
export const TASK_SELECT = `
  t.id, t.project_id, t.title, t.description, t.task_type,
  t.existing_behavior, t.expected_behavior, t.acceptance_criteria, t.reason, t.scope,
  t.features, t.flow, t.rules,
  t.status, t.priority, t.outstanding, t.approval_status, t.approved_by, t.approved_at,
  t.completed_at, t.estimated_hours, t.spent_hours, t.is_additional, t.parent_task_id,
  t.assignee_id, t.created_by, t.due_date, t.start_date, t.created_at, t.updated_at,
  t.request_id, t.requested_by, t.request_approved_by, t.request_approved_at,
  COALESCE(tr.requested_at, ${utcSql("t.created_at")}) AS requested_at,
  t.signed_off_by, t.signed_off_at, t.signoff_note,
  a.name AS assignee_name, c.name AS creator_name, p.name AS project_name,
  rq.name AS requester_name, ap.name AS request_approver_name, so.name AS signer_name,
  dn.name AS done_by_name,
  (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
`;

export const TASK_JOINS = `
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN users rq ON rq.id = t.requested_by
  LEFT JOIN users ap ON ap.id = t.request_approved_by
  LEFT JOIN users so ON so.id = t.signed_off_by
  LEFT JOIN users dn ON dn.id = t.approved_by
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN task_requests tr ON tr.id = t.request_id
`;

/**
 * Task requests matching `whereSql` (alias `r`) with requester/decider names —
 * pending first, then most recent.
 */
export async function fetchTaskRequests(
  whereSql: string,
  params: unknown[]
): Promise<DbRow[]> {
  return query<DbRow[]>(
    `SELECT r.id, r.project_id, r.task_type, r.title,
            r.existing_behavior, r.expected_behavior, r.acceptance_criteria,
            r.reason, r.scope, r.features, r.flow, r.rules,
            r.status, r.requested_by, r.requested_at, r.decided_by, r.decided_at,
            r.decision_note, r.task_id,
            rq.name AS requester_name, dc.name AS decider_name
       FROM task_requests r
       LEFT JOIN users rq ON rq.id = r.requested_by
       LEFT JOIN users dc ON dc.id = r.decided_by
      WHERE ${whereSql}
      ORDER BY (r.status = 'pending') DESC, r.requested_at DESC, r.id DESC
      LIMIT 200`,
    params
  );
}

/**
 * Full task rows matching `whereSql` (alias `t`), with labels/subtask counts
 * attached and comment_count as a number.
 */
export async function fetchTasks(
  whereSql: string,
  params: unknown[],
  orderSql = "t.created_at DESC"
): Promise<DbRow[]> {
  const rows = await query<DbRow[]>(
    `SELECT ${TASK_SELECT} FROM tasks t ${TASK_JOINS}
      WHERE ${whereSql} ORDER BY ${orderSql}`,
    params
  );
  await attachTaskMeta(rows);
  for (const r of rows) r.comment_count = Number(r.comment_count);
  return rows;
}

/**
 * Attach `labels`, `subtask_total`, and `subtask_done` to a list of task rows,
 * using two batched queries (no N+1). Mutates the rows in place.
 */
export async function attachTaskMeta(tasks: DbRow[]): Promise<void> {
  if (tasks.length === 0) return;
  const ids = tasks.map((t) => t.id as number);
  const placeholders = ids.map(() => "?").join(",");

  const labelRows = await query<DbRow[]>(
    `SELECT tl.task_id, l.id, l.project_id, l.name, l.color
     FROM task_labels tl
     JOIN labels l ON l.id = tl.label_id
     WHERE tl.task_id IN (${placeholders})
     ORDER BY l.name`,
    ids
  );
  const subRows = await query<DbRow[]>(
    `SELECT task_id, COUNT(*) AS total, SUM(is_done) AS done
     FROM subtasks WHERE task_id IN (${placeholders}) GROUP BY task_id`,
    ids
  );

  const labelsByTask = new Map<number, Label[]>();
  for (const r of labelRows) {
    const arr = labelsByTask.get(r.task_id) ?? [];
    arr.push({ id: r.id, project_id: r.project_id, name: r.name, color: r.color });
    labelsByTask.set(r.task_id, arr);
  }
  const subByTask = new Map<number, { total: number; done: number }>();
  for (const r of subRows) {
    subByTask.set(r.task_id, { total: Number(r.total), done: Number(r.done) });
  }

  for (const t of tasks) {
    t.labels = labelsByTask.get(t.id as number) ?? [];
    const s = subByTask.get(t.id as number);
    t.subtask_total = s?.total ?? 0;
    t.subtask_done = s?.done ?? 0;
  }
}

/** Replace a task's labels with the given ids (ignoring ids from other projects). */
export async function syncTaskLabels(
  taskId: number,
  projectId: number,
  labelIds: number[]
): Promise<void> {
  await pool.execute(`DELETE FROM task_labels WHERE task_id = ?`, [taskId]);
  if (labelIds.length === 0) return;
  const placeholders = labelIds.map(() => "?").join(",");
  const valid = await query<DbRow[]>(
    `SELECT id FROM labels WHERE project_id = ? AND id IN (${placeholders})`,
    [projectId, ...labelIds]
  );
  for (const row of valid) {
    await pool.execute(
      `INSERT IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)`,
      [taskId, row.id]
    );
  }
}
