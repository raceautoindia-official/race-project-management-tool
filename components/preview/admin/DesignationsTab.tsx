"use client";

// Designations & levels: titles differ between companies, the level number
// lets reports and rules compare seniority across them.

import { useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { newId, usePreview } from "@/lib/preview/store";
import type { Designation } from "@/lib/preview/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  NotConnectedTag,
  SectionTitle,
  inputCls,
  useNotConnected,
} from "@/components/preview/ui";
import { ConfirmModal, HelpText, Toggle } from "./shared";

export default function DesignationsTab() {
  const { state, terms, removeDesignation } = usePreview();
  const { toast } = useToast();
  const notConnected = useNotConnected();
  const [editing, setEditing] = useState<Designation | null>(null);
  const [deleting, setDeleting] = useState<Designation | null>(null);
  const [ruleLevel, setRuleLevel] = useState(4);

  const list = [...state.designations].sort((a, b) => a.level - b.level);
  const headcount = (id: string) => state.people.filter((p) => p.designationId === id).length;
  const nextLevel = list.length ? list[list.length - 1].level + 1 : 1;
  const levels = [...new Set(list.map((g) => g.level))];
  const deletingCount = deleting ? headcount(deleting.id) : 0;

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle
          count={list.length}
          action={<Button onClick={() => setEditing({ id: "", name: "", level: nextLevel })}>+ Add designation</Button>}
        >
          Designations & levels
        </SectionTitle>
        <HelpText>
          Level lets you compare seniority across different titles, e.g. in reports and approval rules. Level 1 is the most junior.
          Two titles can share a level (for example “Lead Engineer” and “Senior Accountant”).
        </HelpText>

        {list.length === 0 ? (
          <EmptyState icon="🪪" title="No designations yet" body="Add titles like Executive or Manager and give each a level." />
        ) : (
          <Card className="divide-y divide-slate-100">
            {list.map((g) => {
              const n = headcount(g.id);
              return (
                <div key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="inline-flex h-8 w-12 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-100">
                    L{g.level}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-900">{g.name}</div>
                    <div className="text-xs text-slate-500">{n} {n === 1 ? "person" : "people"}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(g)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => setDeleting(g)}>Delete</Button>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </div>

      <div>
        <SectionTitle>Rules</SectionTitle>
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-slate-900">
                <span>Only people at level ≥</span>
                <select
                  aria-label="Minimum level"
                  value={ruleLevel}
                  onChange={(e) => setRuleLevel(Number(e.target.value))}
                  className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-sm"
                >
                  {(levels.length ? levels : [1]).map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <span>can own a {terms.project.one.toLowerCase()}</span>
              </div>
              <p className="mt-1 text-slate-500">
                Optional. When on, the owner picker only offers people at this level or above. Rules like this are enforced by the server.
              </p>
              <div className="mt-2"><NotConnectedTag label="Rules are enforced by the backend later" /></div>
            </div>
            <Toggle checked={false} label="Turn on the minimum level rule" onChange={() => notConnected("Ownership level rule")()} />
          </div>
        </Card>
      </div>

      {editing && <DesignationModal desig={editing} onClose={() => setEditing(null)} />}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete designation"
        onConfirm={() => {
          if (!deleting) return;
          removeDesignation(deleting.id);
          toast(`Deleted ${deleting.name}`);
        }}
        body={
          deletingCount > 0 ? (
            <p>
              <strong className="text-slate-900">{deletingCount} {deletingCount === 1 ? "person has" : "people have"}</strong> this designation and
              will be left with <strong className="text-slate-900">no designation</strong>.
            </p>
          ) : (
            <p>No one has this designation, so nobody will be affected.</p>
          )
        }
      />
    </div>
  );
}

function DesignationModal({ desig, onClose }: { desig: Designation; onClose: () => void }) {
  const { upsertDesignation } = usePreview();
  const { toast } = useToast();
  const isNew = !desig.id;
  const [name, setName] = useState(desig.name);
  const [level, setLevel] = useState(String(desig.level));

  const lvl = Number(level);
  const valid = name.trim().length > 0 && Number.isInteger(lvl) && lvl >= 1 && lvl <= 99;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    upsertDesignation({ id: desig.id || newId("g"), name: name.trim(), level: lvl });
    toast(isNew ? `Added ${name.trim()}` : `Saved ${name.trim()}`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={isNew ? "Add designation" : "Edit designation"}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Title">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Team Lead" />
        </Field>
        <Field label="Level" hint="A whole number from 1 (most junior) upwards.">
          <input type="number" min={1} max={99} step={1} className={`${inputCls} max-w-[8rem]`} value={level} onChange={(e) => setLevel(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!valid}>{isNew ? "Add designation" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
