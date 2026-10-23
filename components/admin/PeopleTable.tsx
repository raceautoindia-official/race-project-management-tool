"use client";

import { useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import { RoleBadge } from "@/components/Badge";
import { DepartmentBadge } from "@/components/DepartmentField";
import EditPersonButton from "@/components/EditPersonButton";
import type { Role } from "@/lib/types";

export interface PersonRow {
  id: number;
  empId: string | null;
  name: string;
  email: string | null;
  role: Role;
  department: string | null;
  departmentSource: "attendance" | "pm";
  designation: string | null;
  /** The job title's level, looked up by name. Null when it has none. */
  level: number | null;
}

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/** "L5", or a nudge when the title has no level yet. */
function LevelChip({ person }: { person: PersonRow }) {
  if (!person.designation) return <span className="text-xs text-slate-400">—</span>;
  if (person.level === null) {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
        No level
      </span>
    );
  }
  return (
    <span className="figure inline-flex items-center rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-100">
      L{person.level}
    </span>
  );
}

/** Where the department came from, said quietly under it. */
function SourceNote({ person }: { person: PersonRow }) {
  return (
    <span className="block text-xs text-slate-500">
      {person.departmentSource === "pm" ? "Set in PM" : "From Attendance"}
    </span>
  );
}

function editButton(p: PersonRow) {
  return (
    <EditPersonButton
      userId={p.id}
      name={p.name}
      department={p.department}
      departmentSource={p.departmentSource}
      designation={p.designation}
    />
  );
}

/**
 * Everyone active, with what PM decides about them: department (which
 * otherwise follows Attendance) and job title. Editing reuses the same
 * dialog as the Team page.
 */
export default function PeopleTable({ people }: { people: PersonRow[] }) {
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("");

  const departments = useMemo(
    () => [...new Set(people.map((p) => p.department).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b)),
    [people]
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (dept === "none" ? !!p.department : dept && p.department !== dept) return false;
      if (!q) return true;
      return [p.name, p.empId, p.email, p.designation, p.department].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [people, search, dept]);

  return (
    <section aria-labelledby="people-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="people-heading" className="text-lg font-semibold text-slate-900">
          People
        </h2>
        <span className="text-sm text-slate-600">
          <span className="figure">{shown.length}</span> of <span className="figure">{people.length}</span>
        </span>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, employee ID or job title…"
          aria-label="Search people"
          className={`${inputClass} w-full sm:max-w-xs`}
        />
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          aria-label="Filter by department"
          className={inputClass}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value="none">No department</option>
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          Nobody matches that. Try part of a name or a job title.
        </div>
      ) : (
        <>
          {/* Wide screens: a table */}
          <div className="hidden overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Name</th>
                  <th scope="col" className="px-4 py-2.5">Department</th>
                  <th scope="col" className="px-4 py-2.5">Job title</th>
                  <th scope="col" className="px-4 py-2.5">Level</th>
                  <th scope="col" className="px-4 py-2.5">Role</th>
                  <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={p.name} size="md" />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">{p.name}</div>
                          <div className="figure truncate text-xs text-slate-500">{p.empId ?? "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {p.department ? <DepartmentBadge name={p.department} /> : <span className="text-xs text-slate-400">No department</span>}
                      <SourceNote person={p} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {p.designation ?? <span className="text-xs text-slate-400">No job title</span>}
                    </td>
                    <td className="px-4 py-2.5"><LevelChip person={p} /></td>
                    <td className="px-4 py-2.5"><RoleBadge role={p.role} /></td>
                    <td className="px-4 py-2.5 text-right">{editButton(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: stacked cards */}
          <ul className="space-y-3 md:hidden">
            {shown.map((p) => (
              <li key={p.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={p.name} size="md" />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{p.name}</div>
                      <div className="figure truncate text-xs text-slate-500">{p.empId ?? "—"}</div>
                    </div>
                  </div>
                  {editButton(p)}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Department</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      {p.department ? <DepartmentBadge name={p.department} /> : <span className="text-slate-400">None</span>}
                      <span className="text-xs text-slate-500">
                        {p.departmentSource === "pm" ? "Set in PM" : "From Attendance"}
                      </span>
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Job title</dt>
                    <dd className="flex flex-wrap items-center gap-2 text-slate-700">
                      {p.designation ?? <span className="text-slate-400">None</span>}
                      <LevelChip person={p} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Role</dt>
                    <dd><RoleBadge role={p.role} /></dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
