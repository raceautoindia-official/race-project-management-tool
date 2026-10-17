"use client";

// Custom fields: extra details a company wants on each level of work
// (budget, site, client…), grouped by the level they apply to.

import { useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { newId, usePreview } from "@/lib/preview/store";
import type { CustomField } from "@/lib/preview/types";
import { Button, Card, EmptyState, Field, SectionTitle, inputCls } from "@/components/preview/ui";
import { ConfirmModal, HelpText, Toggle } from "./shared";

const ENTITIES: CustomField["entity"][] = ["project", "task", "subtask"];
const TYPES: { value: CustomField["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Drop-down list" },
  { value: "person", label: "Person" },
];
const typeLabel = (t: CustomField["type"]) => TYPES.find((x) => x.value === t)?.label ?? t;

export default function CustomFieldsTab() {
  const { state, terms, removeCustomField } = usePreview();
  const { toast } = useToast();
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [deleting, setDeleting] = useState<CustomField | null>(null);

  const blank = (entity: CustomField["entity"]): CustomField => ({ id: "", entity, label: "", type: "text", options: [], required: false });

  return (
    <div>
      <SectionTitle count={state.customFields.length} action={<Button onClick={() => setEditing(blank("project"))}>+ Add field</Button>}>
        Custom fields
      </SectionTitle>
      <HelpText>
        Add the extra details your company tracks — a client name, a budget, a plant or site. They appear on the create and edit forms
        for the level you choose, and can be used to filter reports.
      </HelpText>

      <div className="space-y-5">
        {ENTITIES.map((entity) => {
          const fields = state.customFields.filter((f) => f.entity === entity);
          return (
            <div key={entity}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">On every {terms[entity].one.toLowerCase()}</h3>
                <Button size="sm" variant="ghost" onClick={() => setEditing(blank(entity))}>+ Add</Button>
              </div>
              {fields.length === 0 ? (
                <EmptyState icon="🧩" title={`No custom fields on ${terms[entity].many.toLowerCase()} yet`} />
              ) : (
                <Card className="divide-y divide-slate-100">
                  {fields.map((f) => (
                    <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">
                          {f.label}
                          {f.required && <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">Required</span>}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {typeLabel(f.type)}
                          {f.type === "select" && f.options.length > 0 && <> · {f.options.join(", ")}</>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>Edit</Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleting(f)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </Card>
              )}
            </div>
          );
        })}
      </div>

      {editing && <FieldModal field={editing} onClose={() => setEditing(null)} />}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.label ?? ""}”?`}
        confirmLabel="Delete field"
        onConfirm={() => {
          if (!deleting) return;
          removeCustomField(deleting.id);
          toast(`Deleted ${deleting.label}`);
        }}
        body={<p>The field disappears from every form. Values already entered will be hidden and left out of reports.</p>}
      />
    </div>
  );
}

function FieldModal({ field, onClose }: { field: CustomField; onClose: () => void }) {
  const { terms, upsertCustomField } = usePreview();
  const { toast } = useToast();
  const isNew = !field.id;
  const [label, setLabel] = useState(field.label);
  const [entity, setEntity] = useState(field.entity);
  const [type, setType] = useState(field.type);
  const [options, setOptions] = useState(field.options.join(", "));
  const [required, setRequired] = useState(field.required);

  const optionList = options.split(",").map((o) => o.trim()).filter(Boolean);
  const valid = label.trim().length > 0 && (type !== "select" || optionList.length > 0);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    upsertCustomField({
      id: field.id || newId("cf"),
      entity,
      label: label.trim(),
      type,
      options: type === "select" ? optionList : [],
      required,
    });
    toast(isNew ? `Added “${label.trim()}”` : `Saved “${label.trim()}”`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={isNew ? "Add custom field" : "Edit custom field"}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Label">
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus placeholder="e.g. Budget (₹)" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Applies to">
            <select className={inputCls} value={entity} onChange={(e) => setEntity(e.target.value as CustomField["entity"])}>
              {ENTITIES.map((en) => <option key={en} value={en}>{terms[en].many}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as CustomField["type"])}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
        </div>
        {type === "select" && (
          <Field label="Options" hint={optionList.length ? `${optionList.length} options: ${optionList.join(" · ")}` : "Separate options with commas."}>
            <input className={inputCls} value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Head office, Plant 1, Plant 2" />
          </Field>
        )}
        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <span className="text-sm text-slate-700">Required — people must fill it in before saving</span>
          <Toggle checked={required} onChange={setRequired} label="Required" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!valid}>{isNew ? "Add field" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
