"use client";

// The six steps of first-time company setup. Each step is a plain form over
// the shared `Draft`; the page (app/preview/onboarding) owns the state,
// validation and Back/Next.

import { useState } from "react";
import { usePreview } from "@/lib/preview/store";
import { TERMINOLOGY_PRESETS } from "@/lib/preview/seed";
import type { Terminology } from "@/lib/preview/types";
import { Button, NotConnectedTag, inputCls, labelCls, useNotConnected } from "@/components/preview/ui";
import { COMPANY_SIZES, COUNTRIES, TIMEZONES, WEEK_DAYS, suggestedDepartments, suggestedDesignations } from "./data";
import { FieldError, SelectInput, TextInput } from "./fields";

// ── Shared draft shape ─────────────────────────────────────────────────────

export interface InviteRow {
  id: string;
  name: string;
  email: string;
  department: string;
  designation: string;
}

export interface Draft {
  name: string;
  email: string;
  // Held in memory only while the wizard is open — never stored or sent.
  password: string;
  confirm: string;
  companyName: string;
  industry: string;
  size: string;
  country: string;
  timezone: string;
  hoursPerDay: string;
  workingDays: number[];
  terms: Terminology;
  termsTouched: boolean;
  departments: string[];
  designations: { id: string; name: string; level: string }[];
  orgTouched: boolean;
  invites: InviteRow[];
  templateId: string | null;
}

export type Errors = Record<string, string>;

export interface StepProps {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  errors: Errors;
}

let rowSeq = 0;
export const rowId = (p: string) => `${p}-${++rowSeq}`;

export const blankInvite = (): InviteRow => ({ id: rowId("inv"), name: "", email: "", department: "", designation: "" });

export const ladderFor = (industry: string) =>
  suggestedDesignations(industry).map((g) => ({ id: rowId("g"), name: g.name, level: String(g.level) }));

export const presetFor = (industry: string): Terminology =>
  (TERMINOLOGY_PRESETS.find((p) => p.industry === industry) ?? TERMINOLOGY_PRESETS[0]).terms;

function StepIntro({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  );
}

// ── 1. Account ─────────────────────────────────────────────────────────────

export const PASSWORD_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "Upper- and lower-case letters", test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: "At least one number", test: (p) => /\d/.test(p) },
  { label: "At least one symbol (like ! @ #)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function AccountStep({ draft, update, errors }: StepProps) {
  const notConnected = useNotConnected();
  const passed = PASSWORD_RULES.filter((r) => r.test(draft.password)).length;
  const strength = draft.password ? ["Very weak", "Weak", "Fair", "Good", "Strong"][passed] : "";
  const bar = ["bg-red-500", "bg-red-500", "bg-amber-500", "bg-lime-500", "bg-green-600"][passed];
  return (
    <div>
      <StepIntro title="Create your account" body="You'll be the admin for your company's workspace. You can add more admins later." />
      <div className="mb-5 grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="secondary" onClick={notConnected("Sign up with Google")}>
          <span className="font-bold text-blue-600" aria-hidden>G</span> Continue with Google
        </Button>
        <Button type="button" variant="secondary" onClick={notConnected("Sign up with Microsoft")}>
          <span className="font-bold text-sky-600" aria-hidden>▦</span> Continue with Microsoft
        </Button>
      </div>
      <div className="mb-5 flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" /> or use your email <span className="h-px flex-1 bg-slate-200" />
      </div>
      <div className="space-y-4">
        <TextInput label="Your full name" value={draft.name} onChange={(v) => update({ name: v })} error={errors.name} autoComplete="name" />
        <TextInput label="Work email" type="email" value={draft.email} onChange={(v) => update({ email: v })} error={errors.email} placeholder="name@company.com" autoComplete="email" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Password" type="password" value={draft.password} onChange={(v) => update({ password: v })} error={errors.password} autoComplete="new-password" />
          <TextInput label="Confirm password" type="password" value={draft.confirm} onChange={(v) => update({ confirm: v })} error={errors.confirm} autoComplete="new-password" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-1.5 flex-1 gap-1">
              {PASSWORD_RULES.map((r, i) => (
                <span key={r.label} className={`h-full flex-1 rounded-full ${draft.password && i < passed ? bar : "bg-slate-200"}`} />
              ))}
            </div>
            <span className="w-20 text-right text-xs font-medium text-slate-600">{strength}</span>
          </div>
          <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            {PASSWORD_RULES.map((r) => {
              const ok = r.test(draft.password);
              return (
                <li key={r.label} className={ok ? "text-green-700" : "text-slate-500"}>
                  <span aria-hidden>{ok ? "✓" : "○"}</span> {r.label}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
          <strong>Preview only — nothing is sent or stored on a server.</strong> Your password stays on this page and is forgotten when you leave it.
        </p>
      </div>
    </div>
  );
}

// ── 2. Company ─────────────────────────────────────────────────────────────

export function CompanyStep({ draft, update, errors }: StepProps) {
  const hours = Number(draft.hoursPerDay) || 0;
  const weekly = hours * draft.workingDays.length;
  const setIndustry = (industry: string) => {
    // Re-suggest names, departments and levels unless the admin already edited them.
    const patch: Partial<Draft> = { industry };
    if (!draft.termsTouched) patch.terms = presetFor(industry);
    if (!draft.orgTouched) {
      patch.departments = suggestedDepartments(industry);
      patch.designations = ladderFor(industry);
    }
    update(patch);
  };
  const toggleDay = (day: number) =>
    update({ workingDays: draft.workingDays.includes(day) ? draft.workingDays.filter((d) => d !== day) : [...draft.workingDays, day] });

  return (
    <div>
      <StepIntro title="Your company" body="Tell us a little about your company so we can suggest the right setup." />
      <div className="space-y-4">
        <TextInput label="Company name" value={draft.companyName} onChange={(v) => update({ companyName: v })} error={errors.companyName} autoComplete="organization" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectInput label="Industry" value={draft.industry} onChange={setIndustry} options={TERMINOLOGY_PRESETS.map((p) => p.industry)} hint="Sets the suggested names and departments in the next steps." />
          <SelectInput label="Company size" value={draft.size} onChange={(v) => update({ size: v })} options={["", ...COMPANY_SIZES]} error={errors.size} />
          <SelectInput
            label="Country"
            value={draft.country}
            onChange={(v) => update({ country: v, timezone: COUNTRIES.find((c) => c.name === v)?.timezone ?? draft.timezone })}
            options={COUNTRIES.map((c) => c.name)}
          />
          <SelectInput label="Time zone" value={draft.timezone} onChange={(v) => update({ timezone: v })} options={TIMEZONES} hint="Used for due dates, reminders and daily emails." />
        </div>

        <fieldset className="rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">Your work week</legend>
          <p className="mb-3 text-xs text-slate-500">
            We use these to work out each person&apos;s <strong>man-hours capacity</strong> and how busy they are (<strong>utilisation</strong>) in reports.
          </p>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <TextInput label="Hours per day" type="number" value={draft.hoursPerDay} onChange={(v) => update({ hoursPerDay: v })} error={errors.hoursPerDay} />
            <div>
              <span className={labelCls}>Working days</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Working days">
                {WEEK_DAYS.map(({ day, short }) => {
                  const on = draft.workingDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(day)}
                      className={`h-9 w-11 rounded-lg text-sm font-medium transition ${on ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-500 hover:bg-slate-50"}`}
                    >
                      {short}
                    </button>
                  );
                })}
              </div>
              <FieldError error={errors.workingDays} />
            </div>
          </div>
          {weekly > 0 && (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {hours}h × {draft.workingDays.length} days = <strong>{weekly}h per person per week</strong> of capacity.
            </p>
          )}
        </fieldset>
      </div>
    </div>
  );
}

// ── 3. Terminology ─────────────────────────────────────────────────────────

const LEVELS: { key: keyof Terminology; title: string; help: string }[] = [
  { key: "project", title: "Top level", help: "The big piece of work — has one owner." },
  { key: "task", title: "Second level", help: "A part of it — has an owner who reviews the work." },
  { key: "subtask", title: "Third level", help: "A single job assigned to one person." },
];

export function TermsStep({ draft, update, errors }: StepProps) {
  const t = draft.terms;
  const setTerm = (key: keyof Terminology, which: "one" | "many", v: string) =>
    update({ terms: { ...t, [key]: { ...t[key], [which]: v } }, termsTouched: true });
  return (
    <div>
      <StepIntro title="How you name your work" body={<>We&apos;ve filled these in for <strong>{draft.industry}</strong>. Change them to the words your team already uses.</>} />
      <div className="mb-5 rounded-xl bg-indigo-50 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-indigo-500">Preview</p>
        <p className="mt-1 text-lg font-semibold text-indigo-900">
          {t.project.one || "…"} <span className="text-indigo-300">›</span> {t.task.one || "…"} <span className="text-indigo-300">›</span> {t.subtask.one || "…"}
        </p>
        <p className="mt-1 text-xs text-indigo-700">
          Your menu will say &ldquo;{t.project.many || "…"}&rdquo;, and buttons will read &ldquo;+ Add {(t.task.one || "…").toLowerCase()}&rdquo;.
        </p>
      </div>
      <div className="space-y-4">
        {LEVELS.map((l) => (
          <div key={l.key} className="rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-900">{l.title}</p>
            <p className="mb-3 text-xs text-slate-500">{l.help}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Singular (one)" value={t[l.key].one} onChange={(v) => setTerm(l.key, "one", v)} error={errors[`${l.key}.one`]} />
              <TextInput label="Plural (many)" value={t[l.key].many} onChange={(v) => setTerm(l.key, "many", v)} error={errors[`${l.key}.many`]} />
            </div>
          </div>
        ))}
        <button type="button" onClick={() => update({ terms: presetFor(draft.industry), termsTouched: false })} className="text-sm text-indigo-600 hover:underline">
          ↺ Use the {draft.industry} suggestions again
        </button>
      </div>
    </div>
  );
}

// ── 4. Departments & levels ────────────────────────────────────────────────

export function OrgStep({ draft, update, errors }: StepProps) {
  const [newDept, setNewDept] = useState("");
  const [deptError, setDeptError] = useState("");

  const addDept = () => {
    const name = newDept.trim();
    if (!name) return;
    if (draft.departments.some((d) => d.toLowerCase() === name.toLowerCase())) {
      setDeptError(`"${name}" is already in the list.`);
      return;
    }
    update({ departments: [...draft.departments, name], orgTouched: true });
    setNewDept("");
    setDeptError("");
  };
  const setDesig = (id: string, patch: Partial<Draft["designations"][number]>) =>
    update({ designations: draft.designations.map((g) => (g.id === id ? { ...g, ...patch } : g)), orgTouched: true });
  const nextLevel = Math.max(0, ...draft.designations.map((g) => Number(g.level) || 0)) + 1;

  return (
    <div>
      <StepIntro title="Departments & levels" body={<>Suggested for <strong>{draft.industry}</strong>. Remove what you don&apos;t need and add your own — you can change these later in Admin.</>} />

      <section className="mb-8">
        <h3 className="text-sm font-semibold text-slate-900">Departments</h3>
        <p className="mb-3 text-xs text-slate-500">Used to group people and filter reports.</p>
        <div className="flex flex-wrap gap-2">
          {draft.departments.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-sm font-medium text-indigo-800 ring-1 ring-inset ring-indigo-200">
              {d}
              <button
                type="button"
                onClick={() => update({ departments: draft.departments.filter((x) => x !== d), orgTouched: true })}
                className="flex h-5 w-5 items-center justify-center rounded-full text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
                aria-label={`Remove ${d}`}
              >
                ✕
              </button>
            </span>
          ))}
          {draft.departments.length === 0 && <span className="text-sm text-slate-400">No departments yet.</span>}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={newDept}
            onChange={(e) => {
              setNewDept(e.target.value);
              setDeptError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDept();
              }
            }}
            placeholder="Add a department…"
            className={`${inputCls} max-w-xs`}
            aria-label="New department name"
          />
          <Button type="button" variant="secondary" onClick={addDept}>Add</Button>
        </div>
        <FieldError error={deptError || errors.departments} />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-900">Designations (job levels)</h3>
        <p className="mb-3 text-xs text-slate-500">Level 1 is the most junior. Levels help decide who reviews whose work.</p>
        <div className="space-y-2">
          {draft.designations.map((g) => (
            <div key={g.id}>
              <div className="flex items-center gap-2">
                <label className="flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500">
                  L
                  <input
                    type="number"
                    min={1}
                    value={g.level}
                    onChange={(e) => setDesig(g.id, { level: e.target.value })}
                    className={`${inputCls} w-16 px-2`}
                    aria-label={`Level for ${g.name || "designation"}`}
                  />
                </label>
                <input
                  value={g.name}
                  onChange={(e) => setDesig(g.id, { name: e.target.value })}
                  className={`${inputCls} ${errors[`desig-${g.id}`] ? "border-red-400" : ""}`}
                  aria-label="Designation name"
                  placeholder="e.g. Supervisor"
                />
                <button
                  type="button"
                  onClick={() => update({ designations: draft.designations.filter((x) => x.id !== g.id), orgTouched: true })}
                  className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remove ${g.name || "designation"}`}
                >
                  🗑
                </button>
              </div>
              <FieldError error={errors[`desig-${g.id}`]} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => update({ designations: [...draft.designations, { id: rowId("g"), name: "", level: String(nextLevel) }], orgTouched: true })}
          >
            + Add designation
          </Button>
          <button
            type="button"
            onClick={() => update({ departments: suggestedDepartments(draft.industry), designations: ladderFor(draft.industry), orgTouched: false })}
            className="text-sm text-indigo-600 hover:underline"
          >
            ↺ Start again from the suggestions
          </button>
        </div>
        <FieldError error={errors.designations} />
      </section>
    </div>
  );
}

// ── 5. Invite team ─────────────────────────────────────────────────────────

export function InviteStep({ draft, update, errors, onSkip }: StepProps & { onSkip: () => void }) {
  const notConnected = useNotConnected();
  const setRow = (id: string, patch: Partial<InviteRow>) => update({ invites: draft.invites.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const desigs = [...draft.designations].filter((g) => g.name.trim()).sort((a, b) => Number(a.level) - Number(b.level));
  return (
    <div>
      <StepIntro title="Invite your team" body="Add the people who'll use the workspace. Each one gets an email to set their own password." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={notConnected("Importing people from Excel")}>⬆ Import from Excel</Button>
        <Button type="button" variant="secondary" size="sm" onClick={notConnected("Connecting an attendance / HR system")}>⇄ Connect your attendance/HR system</Button>
        <NotConnectedTag label="Invite emails not connected yet" />
      </div>
      <div className="space-y-3">
        {draft.invites.map((r, i) => (
          <div key={r.id} className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Person {i + 1}</span>
              <button type="button" onClick={() => update({ invites: draft.invites.filter((x) => x.id !== r.id) })} className="text-xs text-slate-400 hover:text-red-600">
                Remove
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Name" value={r.name} onChange={(v) => setRow(r.id, { name: v })} error={errors[`inv-${r.id}-name`]} />
              <TextInput label="Email" type="email" value={r.email} onChange={(v) => setRow(r.id, { email: v })} error={errors[`inv-${r.id}-email`]} placeholder="name@company.com" />
              <label className="block">
                <span className={labelCls}>Department</span>
                <select value={r.department} onChange={(e) => setRow(r.id, { department: e.target.value })} className={inputCls}>
                  <option value="">Not set</option>
                  {draft.departments.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>Designation</span>
                <select value={r.designation} onChange={(e) => setRow(r.id, { designation: e.target.value })} className={inputCls}>
                  <option value="">Not set</option>
                  {desigs.map((g) => <option key={g.id} value={g.name}>{g.name} (L{g.level})</option>)}
                </select>
              </label>
            </div>
          </div>
        ))}
        {draft.invites.length === 0 && <p className="text-sm text-slate-500">No one added yet.</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => update({ invites: [...draft.invites, blankInvite()] })}>+ Add another person</Button>
        <button type="button" onClick={onSkip} className="text-sm text-slate-500 hover:text-indigo-600 hover:underline">Skip for now — I&apos;ll invite people later</button>
      </div>
      <p className="mt-2 text-xs text-slate-400">Empty rows are ignored.</p>
    </div>
  );
}

// ── 6. Summary ─────────────────────────────────────────────────────────────

export function DoneStep({ draft, update }: StepProps) {
  const { state } = usePreview();
  const invites = draft.invites.filter((r) => r.name.trim() || r.email.trim());
  const dayNames = WEEK_DAYS.filter((d) => draft.workingDays.includes(d.day)).map((d) => d.short).join(", ");
  const t = draft.terms;
  const industryWord = draft.industry.split(/[ /]/)[0].toLowerCase();
  const templates = [...state.templates].sort(
    (a, b) => Number(b.industry.toLowerCase().includes(industryWord)) - Number(a.industry.toLowerCase().includes(industryWord))
  );
  return (
    <div>
      <StepIntro title="You're all set 🎉" body="Here's what we'll set up. You can change any of it later in Admin & settings." />
      <dl className="grid gap-3 sm:grid-cols-2">
        <Summary label="Your account" value={<>{draft.name}<span className="block text-xs font-normal text-slate-500">{draft.email}</span></>} />
        <Summary label="Company" value={<>{draft.companyName}<span className="block text-xs font-normal text-slate-500">{draft.industry} · {draft.size} · {draft.country}</span></>} />
        <Summary label="Work week" value={<>{draft.hoursPerDay}h a day · {dayNames}<span className="block text-xs font-normal text-slate-500">{draft.timezone}</span></>} />
        <Summary label="Names for your work" value={`${t.project.one} › ${t.task.one} › ${t.subtask.one}`} />
        <Summary label={`Departments (${draft.departments.length})`} value={draft.departments.join(", ") || "None"} />
        <Summary label={`Designations (${draft.designations.length})`} value={[...draft.designations].sort((a, b) => Number(a.level) - Number(b.level)).map((g) => g.name).join(" → ")} />
        <Summary
          label={`Invites (${invites.length})`}
          value={invites.length ? invites.map((r) => r.name).join(", ") : "None yet — you can invite people any time"}
          className="sm:col-span-2"
        />
      </dl>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-slate-900">Start with a template <span className="font-normal text-slate-400">(optional)</span></h3>
        <p className="mb-3 text-xs text-slate-500">We&apos;ll create your first {t.project.one.toLowerCase()} with its {t.task.many.toLowerCase()} and {t.subtask.many.toLowerCase()} ready to fill in.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <TemplateCard selected={draft.templateId === null} onClick={() => update({ templateId: null })} title="Start blank" body={`An empty workspace — add your first ${t.project.one.toLowerCase()} yourself.`} />
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              selected={draft.templateId === tpl.id}
              onClick={() => update({ templateId: tpl.id })}
              title={tpl.name}
              body={`${tpl.industry} · ${tpl.tasks.length} ${t.task.many.toLowerCase()} — ${tpl.description}`}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function Summary({ label, value, className = "" }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg bg-slate-50 px-3 py-2 ${className}`}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function TemplateCard({ selected, onClick, title, body }: { selected: boolean; onClick: () => void; title: string; body: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border p-3 text-left transition ${selected ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200" : "border-slate-200 bg-white hover:border-slate-300"}`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${selected ? "border-indigo-600 bg-indigo-600" : "border-slate-300"}`} aria-hidden>
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
        {title}
      </span>
      <span className="mt-1 block text-xs text-slate-500">{body}</span>
    </button>
  );
}
