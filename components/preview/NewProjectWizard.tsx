"use client";

// Three short steps to create a project: what it is → who & when → how to start.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format } from "date-fns";
import Modal from "@/components/Modal";
import Avatar from "@/components/Avatar";
import { useToast } from "@/components/ToastProvider";
import { usePreview } from "@/lib/preview/store";
import { Button, Field, PersonSelect, inputCls, usePersonMeta } from "./ui";

export default function NewProjectWizard({ open, onClose, initialTemplate = null }: { open: boolean; onClose: () => void; initialTemplate?: string | null }) {
  return open ? <WizardBody onClose={onClose} initialTemplate={initialTemplate} /> : null;
}

function WizardBody({ onClose, initialTemplate }: { onClose: () => void; initialTemplate: string | null }) {
  const { state, me, terms, createProject } = usePreview();
  const router = useRouter();
  const { toast } = useToast();
  const meta = usePersonMeta();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    description: "",
    departmentId: me.departmentId,
    ownerId: me.id as string | null,
    memberIds: [] as string[],
    startDate: format(new Date(), "yyyy-MM-dd"),
    dueDate: format(addDays(new Date(), 30), "yyyy-MM-dd"),
    templateId: initialTemplate,
    expectedHours: "",
  });
  const [memberQuery, setMemberQuery] = useState("");
  const P = terms.project.one;

  const steps = [`About the ${P.toLowerCase()}`, "Owner, team & dates", "How do you want to start?"];
  const canNext =
    step === 0 ? form.name.trim().length > 1 : step === 1 ? !!form.ownerId && form.dueDate >= form.startDate : true;

  const toggleMember = (id: string) =>
    setForm((f) => ({ ...f, memberIds: f.memberIds.includes(id) ? f.memberIds.filter((m) => m !== id) : [...f.memberIds, id] }));

  const create = () => {
    const id = createProject({
      name: form.name.trim(),
      description: form.description.trim(),
      ownerId: form.ownerId!,
      departmentId: form.departmentId,
      startDate: form.startDate,
      dueDate: form.dueDate,
      expectedHours: form.expectedHours ? Number(form.expectedHours) : null,
      memberIds: form.memberIds,
      templateId: form.templateId,
    });
    toast(`${P} “${form.name.trim()}” created`);
    onClose();
    router.push(`/preview/projects/${id}`);
  };

  const candidates = state.people.filter(
    (p) => p.id !== form.ownerId && p.name.toLowerCase().includes(memberQuery.toLowerCase())
  );

  return (
    <Modal open onClose={onClose} title={`New ${P.toLowerCase()}`} widthClass="max-w-2xl">
      {/* Stepper */}
      <ol className="mb-5 flex items-center gap-2 text-xs">
        {steps.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold ${i < step ? "bg-green-500 text-white" : i === step ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-500"}`}>
              {i < step ? "✓" : i + 1}
            </span>
            <span className={`hidden sm:block ${i === step ? "font-medium text-slate-900" : "text-slate-500"}`}>{s}</span>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <Field label={`${P} name`}>
            <input autoFocus className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Website Relaunch, Plant 3 Expansion, FY25 Audit" />
          </Field>
          <Field label="What is it for?" hint="One or two sentences so everyone understands the goal.">
            <textarea rows={3} className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Department">
            <select className={inputCls} value={form.departmentId ?? ""} onChange={(e) => setForm({ ...form, departmentId: e.target.value || null })}>
              <option value="">Cross-department</option>
              {state.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <Field label={`${P} owner`} hint={`Accountable for the whole ${P.toLowerCase()}: creates ${terms.task.many.toLowerCase()}, sets weights and approves finished ${terms.task.many.toLowerCase()}.`}>
            <PersonSelect value={form.ownerId} onChange={(v) => setForm({ ...form, ownerId: v })} allowEmpty={false} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="Due date"><input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          </div>
          {form.dueDate < form.startDate && <p className="text-xs text-red-600">The due date must be after the start date.</p>}
          <Field label="Expected working hours (optional)" hint={`The total effort you expect, in man-hours. ${terms.task.many} and ${terms.subtask.many.toLowerCase()} get their own estimates, and you'll see planned vs actual as work is logged.`}>
            <input type="number" min={0} step={1} className={inputCls} value={form.expectedHours} onChange={(e) => setForm({ ...form, expectedHours: e.target.value })} placeholder="e.g. 400" />
          </Field>
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Team members <span className="font-normal text-slate-400">({form.memberIds.length} selected, optional, you can add more later)</span></p>
            <input className={`${inputCls} mb-2`} placeholder="Search people…" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} />
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1">
              {candidates.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
                  <input type="checkbox" checked={form.memberIds.includes(p.id)} onChange={() => toggleMember(p.id)} className="accent-indigo-600" />
                  <Avatar name={p.name} size="sm" />
                  <span className="text-sm text-slate-800">{p.name}</span>
                  <span className="truncate text-xs text-slate-500">{meta(p.id)?.subtitle}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <button
            onClick={() => setForm({ ...form, templateId: null })}
            className={`w-full rounded-lg border p-3 text-left transition ${form.templateId === null ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 hover:border-slate-300"}`}
          >
            <p className="text-sm font-medium text-slate-900">Start blank</p>
            <p className="text-xs text-slate-500">Add your own {terms.task.many.toLowerCase()} on the next screen.</p>
          </button>
          <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Or start from a template</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {state.templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setForm({ ...form, templateId: t.id })}
                className={`rounded-lg border p-3 text-left transition ${form.templateId === t.id ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 hover:border-slate-300"}`}
              >
                <p className="text-sm font-medium text-slate-900">{t.name}</p>
                <p className="text-xs text-slate-500">{t.industry}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {t.tasks.length} {terms.task.many.toLowerCase()} · {t.tasks.reduce((n, x) => n + x.subtasks.length, 0)} {terms.subtask.many.toLowerCase()}
                </p>
              </button>
            ))}
          </div>
          {form.templateId && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="mb-1 font-medium text-slate-700">What you&apos;ll get:</p>
              {state.templates.find((t) => t.id === form.templateId)?.tasks.map((t) => (
                <p key={t.title}>• {t.title} <span className="text-slate-400">({t.subtasks.join(", ")})</span></p>
              ))}
              <p className="mt-2 text-slate-500">
                {terms.task.many} are owned by the {P.toLowerCase()} owner until you reassign them. {terms.subtask.many} start unassigned.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={step === 0 ? onClose : () => setStep(step - 1)}>{step === 0 ? "Cancel" : "← Back"}</Button>
        {step < 2 ? (
          <Button disabled={!canNext} onClick={() => setStep(step + 1)}>Next →</Button>
        ) : (
          <Button onClick={create}>Create {P.toLowerCase()}</Button>
        )}
      </div>
    </Modal>
  );
}
