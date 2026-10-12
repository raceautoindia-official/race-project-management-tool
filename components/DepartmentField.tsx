"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { departmentTone } from "@/lib/department-colour";

/**
 * Departments, as a thing you pick rather than a thing you type.
 *
 * The list is not ours — it comes from the Attendance app, mirrored onto the
 * people PM already knows about. So these components read whatever is in use
 * rather than offering a fixed set, and both allow a department that is not
 * on the list yet: a new one appears in Attendance before anyone here has
 * been moved into it.
 */

export interface DepartmentRow {
  name: string;
  people: number;
  projects: number;
}

/** The departments in use. Empty while loading, and on failure. */
export function useDepartments(): DepartmentRow[] {
  const [rows, setRows] = useState<DepartmentRow[]>([]);
  useEffect(() => {
    let live = true;
    apiFetch<{ departments: DepartmentRow[] }>("/api/departments")
      .then((r) => live && setRows(r.departments))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, []);
  return rows;
}

const selectClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/** Choosing the department a project belongs to. */
export function DepartmentSelect({
  id,
  value,
  onChange,
  label = "Department",
  hint,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
}) {
  const departments = useDepartments();
  // Whatever it is set to stays on the list, even if nothing else uses it.
  const names = departments.map((d) => d.name);
  const options = value && !names.includes(value) ? [value, ...names] : names;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
      >
        <option value="">No department</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Narrowing a list to one department. */
export function DepartmentFilter({
  value,
  onChange,
  countKey = "projects",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Which count to show beside each name. */
  countKey?: "projects" | "people";
}) {
  const departments = useDepartments();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by department"
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
    >
      <option value="">All departments</option>
      {departments.map((d) => (
        <option key={d.name} value={d.name}>
          {d.name} ({d[countKey]})
        </option>
      ))}
      <option value="none">No department</option>
    </select>
  );
}

/** The department a thing belongs to, said quietly. */
export function DepartmentBadge({ name }: { name?: string | null }) {
  if (!name) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        departmentTone(name).chip
      }`}
    >
      {name}
    </span>
  );
}
