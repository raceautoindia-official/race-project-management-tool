import { pool, query, DbRow } from "./db";
import type { Label } from "./types";

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
