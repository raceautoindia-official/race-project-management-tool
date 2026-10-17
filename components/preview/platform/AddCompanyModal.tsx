"use client";

// "Add company": the platform owner creates a tenant and invites its admin,
// who then goes through first-time setup (/preview/onboarding).

import { useState } from "react";
import Modal from "@/components/Modal";
import { usePreview } from "@/lib/preview/store";
import { TERMINOLOGY_PRESETS } from "@/lib/preview/seed";
import { Button, ButtonLink, NotConnectedTag, inputCls, labelCls } from "@/components/preview/ui";
import { COUNTRIES, isEmail } from "@/components/preview/onboarding/data";
import { TextInput } from "@/components/preview/onboarding/fields";
import { PLANS, PLAN_NAMES, type PlanName } from "./shared";

interface Form {
  name: string;
  industry: string;
  country: string;
  plan: PlanName;
  seats: string;
  adminName: string;
  adminEmail: string;
}

const BLANK: Form = {
  name: "",
  industry: TERMINOLOGY_PRESETS[0].industry,
  country: "India",
  plan: "Business",
  seats: "25",
  adminName: "",
  adminEmail: "",
};

export default function AddCompanyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, inviteCompany } = usePreview();
  const [form, setForm] = useState<Form>(BLANK);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [sentTo, setSentTo] = useState<Form | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const close = () => {
    setForm(BLANK);
    setErrors({});
    setSentTo(null);
    onClose();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const err: typeof errors = {};
    const seats = Number(form.seats);
    if (!form.name.trim()) err.name = "Please enter the company's name.";
    else if (state.companies.some((c) => c.name.toLowerCase() === form.name.trim().toLowerCase())) err.name = "A company with this name already exists.";
    if (!Number.isInteger(seats) || seats < 1) err.seats = "Enter a whole number of seats (at least 1).";
    if (!form.adminName.trim()) err.adminName = "Who will set up this workspace?";
    if (!form.adminEmail.trim()) err.adminEmail = "We need an email to send the invite to.";
    else if (!isEmail(form.adminEmail)) err.adminEmail = "That doesn't look like an email address.";
    setErrors(err);
    if (Object.keys(err).length) return;
    inviteCompany({
      name: form.name.trim(),
      industry: form.industry,
      country: form.country,
      plan: form.plan,
      seats,
      adminName: form.adminName.trim(),
      adminEmail: form.adminEmail.trim(),
    });
    setSentTo(form);
  };

  const limit = PLANS[form.plan].seatLimit;

  return (
    <Modal open={open} onClose={close} title={sentTo ? "Company added" : "Add a company"} widthClass="max-w-xl">
      {sentTo ? (
        <div className="space-y-4 text-sm text-slate-600">
          <div className="flex gap-3 rounded-lg bg-green-50 p-3 text-green-800">
            <span className="text-lg" aria-hidden>✓</span>
            <p>
              <strong>{sentTo.name}</strong> is on the platform and marked <em>Setting up</em> until its admin finishes onboarding.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="font-medium text-slate-800">An invite email goes to the admin</p>
            <p className="mt-0.5">
              {sentTo.adminName} ({sentTo.adminEmail}) gets a link to create their account and set up the workspace.
            </p>
            <div className="mt-2"><NotConnectedTag label="Email not connected yet" /></div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={close}>Done</Button>
            <ButtonLink href="/preview/onboarding">Preview the onboarding they&apos;ll see →</ButtonLink>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <TextInput label="Company name" value={form.name} onChange={(v) => set("name", v)} error={errors.name} placeholder="e.g. Kaveri Auto Components" />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>Industry</span>
              <select value={form.industry} onChange={(e) => set("industry", e.target.value)} className={inputCls}>
                {TERMINOLOGY_PRESETS.map((p) => <option key={p.industry}>{p.industry}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Country</span>
              <select value={form.country} onChange={(e) => set("country", e.target.value)} className={inputCls}>
                {COUNTRIES.map((c) => <option key={c.name}>{c.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Plan</span>
              <select value={form.plan} onChange={(e) => set("plan", e.target.value as PlanName)} className={inputCls}>
                {PLAN_NAMES.map((p) => <option key={p}>{p}</option>)}
              </select>
              <span className="mt-1 block text-xs text-slate-500">{limit ? `Up to ${limit} people` : "Unlimited people"}</span>
            </label>
            <TextInput label="Seats" type="number" value={form.seats} onChange={(v) => set("seats", v)} error={errors.seats} />
          </div>
          <div className="border-t border-slate-100 pt-4">
            <p className="mb-3 text-sm font-semibold text-slate-900">Company admin</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="Full name" value={form.adminName} onChange={(v) => set("adminName", v)} error={errors.adminName} />
              <TextInput label="Work email" type="email" value={form.adminEmail} onChange={(v) => set("adminEmail", v)} error={errors.adminEmail} placeholder="name@company.com" />
            </div>
          </div>
          {limit !== null && Number(form.seats) > limit && (
            <p className="text-xs text-amber-700">Heads up: the {form.plan} plan normally allows up to {limit} people.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit">Add company & invite admin</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
