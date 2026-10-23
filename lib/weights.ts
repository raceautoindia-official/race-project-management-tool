import { query, DbRow } from "./db";
import { badRequest } from "./http";
import { weightsProblem } from "./work-engine";

/**
 * Save new weights for one set of siblings (a task's subtasks, or a
 * project's tasks). `reset` puts them all back to an even, automatic split.
 * Otherwise every live sibling must be given a weight, and they must add up
 * to 100 — the editor rebalances as you type, so this only rejects a bad
 * client. Weights given are stored as manual.
 */
export async function saveWeights(
  table: "tasks" | "subtasks",
  parentColumn: "project_id" | "task_id",
  parentId: number,
  body: { reset: true } | { weights: { id: number; weight: number }[] }
): Promise<void> {
  const keepStamp = table === "tasks" ? "updated_at = updated_at, " : "";
  if ("reset" in body) {
    await query(
      `UPDATE ${table} SET ${keepStamp}weight = 0, weight_mode = 'auto' WHERE ${parentColumn} = ?`,
      [parentId]
    );
    return;
  }
  const rows = await query<DbRow[]>(
    `SELECT id${table === "subtasks" ? ", status" : ""} FROM ${table} WHERE ${parentColumn} = ?`,
    [parentId]
  );
  const live = rows.filter((r) => r.status !== "cancelled").map((r) => Number(r.id));
  const given = new Map(body.weights.map((w) => [w.id, w.weight]));
  if (given.size !== body.weights.length) throw badRequest("An item appears twice");
  for (const id of given.keys()) {
    if (!live.includes(id)) throw badRequest("A weight was sent for something that isn't part of this list");
  }
  if (live.some((id) => !given.has(id))) throw badRequest("Give every item a weight");
  const problem = weightsProblem([...given.values()]);
  if (problem) throw badRequest(problem);
  for (const [id, weight] of given) {
    await query(`UPDATE ${table} SET ${keepStamp}weight = ?, weight_mode = 'manual' WHERE id = ?`, [
      Math.round(weight * 1000) / 1000,
      id,
    ]);
  }
}
