"use client";

// People: who is in the company, which department and designation they hold,
// and who can change settings. In production this list is synced from the
// Attendance system, so manual adds are a fallback.

import { useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { usePreview } from "@/lib/preview/store";
import type { Person } from "@/lib/preview/types";
import {
  Button,
  Card,
  DeptBadge,
  EmptyState,
  Field,
  NotConnectedTag,
  inputCls,
  useNotConnected,
} from "@/components/preview/ui";
import { Toggle } from "./shared";

const smallSelect =
  "w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100";

export default function PeopleTab() {
  const { state, me, updatePerson } = usePreview();
  const { toast } = useToast();
  const notConnected = useNotConnected();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...state.people]
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.people, query]);

  const deptName = (id: string | null) => state.departments.find((d) => d.id === id)?.name ?? "No department";
  const desigName = (id: string | null) => state.designations.find((g) => g.id === id)?.name ?? "No designation";

  // Every inline change saves straight away and confirms with a toast.
  const change = (p: Person, patch: Partial<Person>, what: string) => {
    updatePerson(p.id, patch);
    toast(`${p.name}: ${what}`);
  };

  const controls = (p: Person) => ({
    dept: (
      <select
        aria-label={`Department for ${p.name}`}
        value={p.departmentId ?? ""}
        onChange={(e) => {
          const v = e.target.value || null;
          change(p, { departmentId: v }, `moved to ${deptName(v)}`);
        }}
        className={smallSelect}
      >
        <option value="">No department</option>
        {state.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    ),
    desig: (
      <select
        aria-label={`Designation for ${p.name}`}
        value={p.designationId ?? ""}
        onChange={(e) => {
          const v = e.target.value || null;
          change(p, { designationId: v }, `designation set to ${desigName(v)}`);
        }}
        className={smallSelect}
      >
        <option value="">No designation</option>
        {state.designations.map((g) => <option key={g.id} value={g.id}>{g.name} (L{g.level})</option>)}
      </select>
    ),
    admin: (
      <Toggle
        checked={p.isAdmin}
        label={`Admin access for ${p.name}`}
        // Removing your own admin access would lock you out of this page.
        disabled={p.id === me.id}
        title={p.id === me.id ? "You can't remove your own admin access" : undefined}
        onChange={(v) => change(p, { isAdmin: v }, v ? "is now an admin" : "is no longer an admin")}
      />
    ),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-700">
          <p className="font-medium text-slate-900">People and their departments/designations will sync from the Attendance system</p>
          <p className="mt-0.5 text-slate-600">Until then you can edit them here. Changes made here stay in this preview.</p>
          <div className="mt-2"><NotConnectedTag label="Attendance sync not connected yet" /></div>
        </div>
        <Button variant="secondary" className="shrink-0" onClick={notConnected("Sync from Attendance")}>⟳ Sync now</Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          aria-label="Search people"
          className={`${inputCls} sm:max-w-xs`}
        />
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{people.length} of {state.people.length} people</span>
          <Button onClick={() => setAdding(true)}>+ Add person</Button>
        </div>
      </div>

      {people.length === 0 ? (
        <EmptyState icon="🔍" title="No one matches that search" body="Try part of a name or an email address." />
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Department</th>
                  <th className="px-4 py-2.5">Designation</th>
                  <th className="px-4 py-2.5 text-center">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {people.map((p) => {
                  const c = controls(p);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={p.name} size="md" />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900">
                              {p.name}
                              {p.id === me.id && <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>}
                            </div>
                            <div className="truncate text-xs text-slate-500">{p.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="w-52 px-4 py-2.5">{c.dept}</td>
                      <td className="w-56 px-4 py-2.5">{c.desig}</td>
                      <td className="w-20 px-4 py-2.5"><div className="flex justify-center">{c.admin}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Mobile: stacked cards */}
          <div className="space-y-3 md:hidden">
            {people.map((p) => {
              const c = controls(p);
              return (
                <Card key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={p.name} size="md" />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">
                          {p.name}
                          {p.id === me.id && <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>}
                        </div>
                        <div className="truncate text-xs text-slate-500">{p.email}</div>
                      </div>
                    </div>
                    <DeptBadge id={p.departmentId} />
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <div className="text-xs text-slate-500"><span className="mb-1 block">Department</span>{c.dept}</div>
                    <div className="text-xs text-slate-500"><span className="mb-1 block">Designation</span>{c.desig}</div>
                    <div className="flex items-center justify-between pt-1 text-sm text-slate-700">
                      <span>Admin access</span>
                      {c.admin}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <AddPersonModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddPersonModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, addPerson } = usePreview();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");

  const emailTaken = state.people.some((p) => p.email.toLowerCase() === email.trim().toLowerCase());
  const valid = name.trim().length > 0 && /\S+@\S+\.\S+/.test(email.trim()) && !emailTaken;

  const close = () => {
    setName("");
    setEmail("");
    setDepartmentId("");
    setDesignationId("");
    onClose();
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    addPerson({
      name: name.trim(),
      email: email.trim(),
      departmentId: departmentId || null,
      designationId: designationId || null,
      isAdmin: false,
    });
    toast(`${name.trim()} added`);
    close();
  };

  return (
    <Modal open={open} onClose={close} title="Add person">
      <form onSubmit={save} className="space-y-4">
        <Field label="Full name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Asha Menon" />
        </Field>
        <Field label="Work email" hint={emailTaken ? "Someone already uses this email." : undefined}>
          <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department">
            <select className={inputCls} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">No department</option>
              {state.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Designation">
            <select className={inputCls} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
              <option value="">No designation</option>
              {state.designations.map((g) => <option key={g.id} value={g.id}>{g.name} (L{g.level})</option>)}
            </select>
          </Field>
        </div>
        <p className="text-xs text-slate-500">Once the Attendance sync is connected, new joiners will appear here automatically.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" disabled={!valid}>Add person</Button>
        </div>
      </form>
    </Modal>
  );
}
