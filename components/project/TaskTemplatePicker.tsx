"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { departmentTone } from "@/lib/department-colour";

/**
 * Starting a task from one your department already wrote down.
 *
 * It fills the form in — title, type, specification, priority, estimate,
 * labels — and then gets out of the way. Everything stays editable, and
 * nothing is created until Create task is pressed, so picking the wrong one
 * costs a second rather than a cleanup.
 *
 * Your own department's templates are listed first because they are the ones
 * you mean nearly every time; the rest are still there to borrow.
 */

export interface TaskTemplate {
  id: number;
  name: string;
  department: string | null;
  data: Record<string, unknown> | string;
  created_by_name?: string | null;
}

/** MySQL hands JSON back as an object or its string form, depending. */
export function templateData(t: TaskTemplate): Record<string, unknown> {
  if (typeof t.data === "string") {
    try {
      return JSON.parse(t.data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return t.data ?? {};
}

export default function TaskTemplatePicker({
  myDepartment,
  onApply,
}: {
  myDepartment?: string | null;
  onApply: (t: TaskTemplate) => void;
}) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);

  useEffect(() => {
    let live = true;
    apiFetch<{ templates: TaskTemplate[] }>("/api/task-templates")
      .then((r) => live && setTemplates(r.templates))
      .catch(() => live && setTemplates([]));
    return () => {
      live = false;
    };
  }, []);

  if (templates.length === 0) return null;

  const mine = templates.filter((t) => myDepartment && t.department === myDepartment);
  const others = templates.filter((t) => !myDepartment || t.department !== myDepartment);

  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
      <label
        htmlFor="task-template"
        className="mb-1 block text-sm font-medium text-slate-700"
      >
        Start from a template
      </label>
      <select
        id="task-template"
        defaultValue=""
        onChange={(e) => {
          const picked = templates.find((t) => String(t.id) === e.target.value);
          if (picked) onApply(picked);
          // Back to the prompt: it is an action, not a stored choice.
          e.target.value = "";
        }}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">Blank task</option>
        {mine.length > 0 && (
          <optgroup label={`${myDepartment} — yours`}>
            {mine.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label={mine.length ? "Other departments" : "Templates"}>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.department ? ` — ${t.department}` : ""}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <p className="mt-1 text-xs text-slate-600">
        It fills the form in. Change anything before creating the task.
      </p>
    </div>
  );
}

/** The department a template belongs to, for lists that show several. */
export function TemplateDepartmentChip({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        departmentTone(name).chip
      }`}
    >
      {name}
    </span>
  );
}
