"use client";

// Departments: name + colour (used for badges everywhere) and headcount.

import { useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { LABEL_COLORS, labelChipClass, labelSwatchClass } from "@/lib/colors";
import { newId, usePreview } from "@/lib/preview/store";
import type { Department } from "@/lib/preview/types";
import { Button, Card, EmptyState, Field, SectionTitle, inputCls } from "@/components/preview/ui";
import { ConfirmModal, HelpText } from "./shared";

export default function DepartmentsTab() {
  const { state, removeDepartment } = usePreview();
  const { toast } = useToast();
  // `null` = closed, an object with an empty id = adding a new one.
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const headcount = (id: string) => state.people.filter((p) => p.departmentId === id).length;
  const unassigned = state.people.filter((p) => !p.departmentId).length;
  const deletingCount = deleting ? headcount(deleting.id) : 0;

  return (
    <div>
      <SectionTitle
        count={state.departments.length}
        action={<Button onClick={() => setEditing({ id: "", name: "", color: "blue" })}>+ Add department</Button>}
      >
        Departments
      </SectionTitle>
      <HelpText>Departments group people and colour-code their badges across the app. Use them to filter reports and pick owners quickly.</HelpText>

      {state.departments.length === 0 ? (
        <EmptyState icon="🏢" title="No departments yet" body="Add your first department to start grouping people." />
      ) : (
        <Card className="divide-y divide-slate-100">
          {state.departments.map((d) => {
            const n = headcount(d.id);
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`h-4 w-4 shrink-0 rounded-full ${labelSwatchClass(d.color)}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${labelChipClass(d.color)}`}>{d.name}</span>
                  <span className="ml-2 text-sm text-slate-500">{n} {n === 1 ? "person" : "people"}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(d)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleting(d)}>Delete</Button>
                </div>
              </div>
            );
          })}
          {unassigned > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 text-sm text-slate-500">
              <span className="h-4 w-4 shrink-0 rounded-full border-2 border-dashed border-slate-300" aria-hidden />
              No department — {unassigned} {unassigned === 1 ? "person" : "people"}
            </div>
          )}
        </Card>
      )}

      {editing && <DepartmentModal dept={editing} onClose={() => setEditing(null)} />}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete department"
        onConfirm={() => {
          if (!deleting) return;
          removeDepartment(deleting.id);
          toast(`Deleted ${deleting.name}`);
        }}
        body={
          deletingCount > 0 ? (
            <p>
              <strong className="text-slate-900">{deletingCount} {deletingCount === 1 ? "person" : "people"}</strong> in this department will become
              <strong className="text-slate-900"> “No department”</strong>. You can move them to another department afterwards.
            </p>
          ) : (
            <p>No one is in this department, so nobody will be affected.</p>
          )
        }
      />
    </div>
  );
}

function DepartmentModal({ dept, onClose }: { dept: Department; onClose: () => void }) {
  const { state, upsertDepartment } = usePreview();
  const { toast } = useToast();
  const isNew = !dept.id;
  const [name, setName] = useState(dept.name);
  const [color, setColor] = useState(dept.color);

  const clash = state.departments.some((d) => d.id !== dept.id && d.name.toLowerCase() === name.trim().toLowerCase());
  const valid = name.trim().length > 0 && !clash;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    upsertDepartment({ id: dept.id || newId("d"), name: name.trim(), color });
    toast(isNew ? `Added ${name.trim()}` : `Saved ${name.trim()}`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={isNew ? "Add department" : "Edit department"}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Name" hint={clash ? "A department with this name already exists." : undefined}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Quality Assurance" />
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Colour</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                title={c}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full ${labelSwatchClass(c)} ring-offset-2 transition ${color === c ? "ring-2 ring-indigo-600" : "hover:scale-110"}`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          Preview:
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${labelChipClass(color)}`}>{name.trim() || "Department"}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!valid}>{isNew ? "Add department" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
