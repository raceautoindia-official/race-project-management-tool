"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatDate } from "@/lib/format";
import { DepartmentBadge } from "@/components/DepartmentField";
import type { ApprovalStatus } from "@/lib/types";

export interface OutstandingTask {
  id: number;
  project_id: number;
  title: string;
  project_name: string;
  /** Its project's department. */
  department: string | null;
  assignee_name: string | null;
  due_date: string | null;
  status: string;
  outstanding: boolean;
  approval_status: ApprovalStatus;
  days_overdue: number | null;
  can_manage: boolean;
}

export default function OutstandingView({
  initial,
}: {
  initial: OutstandingTask[];
}) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<OutstandingTask[]>(initial);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [department, setDepartment] = useState("");

  // Only the departments actually represented here: offering a filter that
  // can only ever return nothing is worse than not offering it.
  const departments = [...new Set(tasks.map((t) => t.department).filter(Boolean))]
    .sort() as string[];
  const shown = department
    ? tasks.filter((t) =>
        department === "none" ? !t.department : t.department === department
      )
    : tasks;

  async function decide(id: number, decision: "approve" | "reject") {
    setBusyId(id);
    try {
      // Approve = mark Done; reject = send back to In Progress (review gate).
      await apiFetch(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: decision === "approve" ? "done" : "in_progress",
        }),
      });
      setTasks((ts) => ts.filter((t) => t.id !== id));
      toast(decision === "approve" ? "Approved & marked done" : "Sent back to assignee");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">
        🎉 Nothing outstanding. Overdue tasks and completions awaiting approval
        will appear here.
      </div>
    );
  }

  return (
    <div>
      {departments.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="outstanding-department" className="text-sm text-slate-600">
            Department
          </label>
          <select
            id="outstanding-department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">All departments ({tasks.length})</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d} ({tasks.filter((t) => t.department === d).length})
              </option>
            ))}
            {tasks.some((t) => !t.department) && (
              <option value="none">
                No department ({tasks.filter((t) => !t.department).length})
              </option>
            )}
          </select>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Task</th>
            <th className="px-4 py-2">Project</th>
            <th className="px-4 py-2">Assignee</th>
            <th className="px-4 py-2">Due</th>
            <th className="px-4 py-2">State</th>
            <th className="px-4 py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.map((t) => {
            const inReview = t.status === "review";
            return (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium text-slate-800">{t.title}</td>
                <td className="px-4 py-2 text-slate-600">
                  <Link
                    href={`/projects/${t.project_id}`}
                    className="inline-block py-1 hover:text-indigo-600"
                  >
                    {t.project_name}
                  </Link>
                  <DepartmentBadge name={t.department} />
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {t.assignee_name ?? "—"}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {t.due_date ? formatDate(t.due_date) : "—"}
                  {t.days_overdue != null && t.days_overdue > 0 && (
                    <span className="ml-1 text-xs text-red-600">
                      ({t.days_overdue}d late)
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {inReview ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      In review
                    </span>
                  ) : (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Overdue
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {inReview && t.can_manage ? (
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => decide(t.id, "approve")}
                        disabled={busyId === t.id}
                        className="rounded-lg bg-green-700 px-3 py-1 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => decide(t.id, "reject")}
                        disabled={busyId === t.id}
                        className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Send back
                      </button>
                    </div>
                  ) : inReview ? (
                    <span className="text-xs text-slate-500">Awaiting lead/admin</span>
                  ) : (
                    <Link
                      href={`/projects/${t.project_id}`}
                      className="inline-block py-1 text-xs text-indigo-600 hover:underline"
                    >
                      Open
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
