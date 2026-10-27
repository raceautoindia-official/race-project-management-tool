import { apiFetch } from "@/lib/api-client";
import type { Task, TaskRequest } from "@/lib/types";

/**
 * New work goes one of two ways, decided by who is asking rather than by
 * which form they opened: someone who manages the project creates the task;
 * anyone else sends it to a lead for approval. The task form and the inline
 * "+ Add task" row both send through here.
 */
const NOT_THE_ASKERS = ["assigneeId", "requestedById", "status", "labelIds"];

export type NewWork ={ kind: "task"; task: Task } | { kind: "request"; request: TaskRequest };

export async function sendNewWork(
  projectId: number,
  asRequest: boolean,
  body: Record<string, unknown>
): Promise<NewWork> {
  if (asRequest) {
    // The approver picks the owner, and the trail records the requester:
    // neither is the asker's to set.
    const rest = Object.fromEntries(Object.entries(body).filter(([k]) => !NOT_THE_ASKERS.includes(k)));
    const res = await apiFetch<{ request: TaskRequest }>(`/api/projects/${projectId}/requests`, {
      method: "POST",
      body: JSON.stringify(rest),
    });
    return { kind: "request", request: res.request };
  }
  const res = await apiFetch<{ task: Task }>(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { kind: "task", task: res.task };
}

export type FormMode = "quick" | "detailed";

const MODE_KEY = "pm.taskForm.mode";

/** The mode this person last created work in (Quick when unknown). */
export function lastMode(): FormMode {
  try {
    return localStorage.getItem(MODE_KEY) === "detailed" ? "detailed" : "quick";
  } catch {
    return "quick";
  }
}

export function rememberMode(mode: FormMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private window or blocked storage: the form simply opens in Quick.
  }
}

/** What the inline row hands the full form ("More options…"). */
export interface NewWorkDraft {
  title?: string;
  assigneeId?: number | null;
  startDate?: string;
  dueDate?: string;
  priority?: string;
}
