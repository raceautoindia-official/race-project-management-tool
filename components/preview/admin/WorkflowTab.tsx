"use client";

// Workflow & terminology: what the three levels are called, company name,
// status labels, how progress is counted, and who reviews what.
// Every page reads `terms` / `statusLabel` from the store, so saving here
// renames the whole app instantly.

import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { usePreview } from "@/lib/preview/store";
import { TERMINOLOGY_PRESETS } from "@/lib/preview/seed";
import { STATUS_CATEGORIES, type OrgSettings, type StatusCategory, type Terminology } from "@/lib/preview/types";
import { Button, Card, Field, SectionTitle, StatusPill, inputCls } from "@/components/preview/ui";
import { HelpText } from "./shared";

const LEVELS = ["project", "task", "subtask"] as const;
const LEVEL_NAMES: Record<(typeof LEVELS)[number], string> = { project: "Top level", task: "Second level", subtask: "Third level" };

const STATUS_HELP: Record<StatusCategory, string> = {
  not_started: "Work that hasn't begun.",
  in_progress: "Someone is working on it.",
  in_review: "Finished and waiting for the owner to approve. Doesn't count toward progress yet.",
  done: "Approved. Counts toward progress.",
  cancelled: "No longer needed. Left out of progress.",
};

const sameTerms = (a: Terminology, b: Terminology) => LEVELS.every((k) => a[k].one === b[k].one && a[k].many === b[k].many);

export default function WorkflowTab() {
  const { state, terms } = usePreview();
  const org = state.org;
  // Keys remount each draft form when the saved value changes elsewhere
  // (e.g. "Reset demo"), so drafts never show stale settings.
  return (
    <div className="space-y-8">
      <TerminologySection key={`${org.industry}|${JSON.stringify(org.terminology)}`} />
      <CompanySection key={org.companyName} />
      <WorkWeekSection key={`${org.workingHoursPerDay}|${org.workingDays.join()}`} />
      <StatusSection key={JSON.stringify(org.statusLabels)} />
      <ProgressSection />
      <div>
        <SectionTitle>Review rules</SectionTitle>
        <Card className="p-4 text-sm text-slate-700">
          <ul className="space-y-2">
            <li className="flex gap-2"><span aria-hidden className="text-indigo-500">✓</span>Every {terms.subtask.one.toLowerCase()} is reviewed by its {terms.task.one.toLowerCase()} owner.</li>
            <li className="flex gap-2"><span aria-hidden className="text-indigo-500">✓</span>Every {terms.task.one.toLowerCase()} is reviewed by its {terms.project.one.toLowerCase()} owner.</li>
            <li className="flex gap-2"><span aria-hidden className="text-indigo-500">✓</span>If the reviewer finishes their own work, it is approved directly.</li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            These rules are built in so every piece of work at {state.org.companyName} has exactly one person who signs it off.
          </p>
        </Card>
      </div>
    </div>
  );
}

function TerminologySection() {
  const { state, updateOrg } = usePreview();
  const { toast } = useToast();
  // Local draft so the user can try presets before saving.
  const [draft, setDraft] = useState<Terminology>(state.org.terminology);
  const [industry, setIndustry] = useState(state.org.industry);

  const dirty = !sameTerms(draft, state.org.terminology) || industry !== state.org.industry;
  const valid = LEVELS.every((k) => draft[k].one.trim() && draft[k].many.trim());

  const pickPreset = (name: string) => {
    const preset = TERMINOLOGY_PRESETS.find((p) => p.industry === name);
    setIndustry(name);
    if (preset) setDraft(structuredClone(preset.terms));
  };

  const setTerm = (level: (typeof LEVELS)[number], form: "one" | "many", value: string) => {
    setDraft((d) => ({ ...d, [level]: { ...d[level], [form]: value } }));
    // Hand-edited names no longer match a preset exactly.
    setIndustry((cur) => (cur === "Custom" ? cur : "Custom"));
  };

  const save = () => {
    const clean = Object.fromEntries(LEVELS.map((k) => [k, { one: draft[k].one.trim(), many: draft[k].many.trim() }])) as unknown as Terminology;
    updateOrg({ terminology: clean, industry });
    toast(`Saved — the app now talks about ${clean.project.many.toLowerCase()}, ${clean.task.many.toLowerCase()} and ${clean.subtask.many.toLowerCase()}`);
  };

  const presetNames = TERMINOLOGY_PRESETS.map((p) => p.industry);

  return (
    <div>
      <SectionTitle>Terminology</SectionTitle>
      <HelpText>
        Call the three levels of work whatever your team already calls them. Saving renames the whole app instantly — menus, buttons, reports and emails.
      </HelpText>
      <Card className="space-y-4 p-4">
        <Field label="Industry preset" hint="Pick one to fill in the names below, then tweak them if you like.">
          <select className={`${inputCls} sm:max-w-sm`} value={industry} onChange={(e) => pickPreset(e.target.value)}>
            {presetNames.map((n) => <option key={n} value={n}>{n}</option>)}
            {!presetNames.includes(industry) && <option value={industry}>{industry || "Custom"}</option>}
            {industry !== "Custom" && <option value="Custom">Custom</option>}
          </select>
        </Field>

        <div className="space-y-3">
          {LEVELS.map((k) => (
            <div key={k} className="grid grid-cols-2 gap-3 sm:grid-cols-[9rem_1fr_1fr] sm:items-end">
              <div className="col-span-2 text-sm font-medium text-slate-700 sm:col-span-1 sm:pb-2">{LEVEL_NAMES[k]}</div>
              <Field label="Singular">
                <input className={inputCls} value={draft[k].one} onChange={(e) => setTerm(k, "one", e.target.value)} />
              </Field>
              <Field label="Plural">
                <input className={inputCls} value={draft[k].many} onChange={(e) => setTerm(k, "many", e.target.value)} />
              </Field>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
          <span className="text-slate-500">Preview: </span>
          <span className="font-medium text-slate-900">
            {draft.project.one || "…"} <span className="text-slate-400">›</span> {draft.task.one || "…"} <span className="text-slate-400">›</span> {draft.subtask.one || "…"}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && (
            <Button variant="ghost" onClick={() => { setDraft(state.org.terminology); setIndustry(state.org.industry); }}>
              Undo changes
            </Button>
          )}
          <Button onClick={save} disabled={!dirty || !valid}>Save terminology</Button>
        </div>
      </Card>
    </div>
  );
}

function CompanySection() {
  const { state, updateOrg } = usePreview();
  const { toast } = useToast();
  const [name, setName] = useState(state.org.companyName);
  const dirty = name.trim() !== state.org.companyName;

  return (
    <div>
      <SectionTitle>Company</SectionTitle>
      <Card className="p-4">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !dirty) return;
            updateOrg({ companyName: name.trim() });
            toast("Company name saved");
          }}
        >
          <div className="flex-1">
            <Field label="Company name" hint="Shown in the sidebar, emails and exported reports.">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={!dirty || !name.trim()} className="sm:mb-5">Save</Button>
        </form>
      </Card>
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Hours per day and working days: the basis for capacity and utilisation. */
function WorkWeekSection() {
  const { state, updateOrg } = usePreview();
  const { toast } = useToast();
  const [hours, setHours] = useState(String(state.org.workingHoursPerDay));
  const [days, setDays] = useState<number[]>(state.org.workingDays);
  const dirty = Number(hours) !== state.org.workingHoursPerDay || days.slice().sort().join() !== state.org.workingDays.slice().sort().join();
  const valid = Number(hours) > 0 && Number(hours) <= 24 && days.length > 0;
  return (
    <section>
      <SectionTitle>Work week</SectionTitle>
      <HelpText>Used to turn logged man-hours into capacity and utilisation on Team, Timesheet and Reports.</HelpText>
      <Card className="mt-3 space-y-4 p-4">
        <Field label="Working hours per day">
          <input type="number" min={1} max={24} step={0.5} className={`${inputCls} w-32`} value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Working days</p>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDays((x) => (on ? x.filter((y) => y !== d) : [...x, d]))}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${on ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"}`}
                >
                  {DAYS[d]}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Weekly capacity per person: <strong>{valid ? `${Number(hours) * days.length}h` : "—"}</strong>
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            disabled={!dirty || !valid}
            onClick={() => {
              updateOrg({ workingHoursPerDay: Number(hours), workingDays: days.slice().sort() });
              toast("Work week saved");
            }}
          >
            Save work week
          </Button>
        </div>
      </Card>
    </section>
  );
}

function StatusSection() {
  const { state, updateOrg } = usePreview();
  const { toast } = useToast();
  const [labels, setLabels] = useState<OrgSettings["statusLabels"]>(state.org.statusLabels);
  const dirty = STATUS_CATEGORIES.some((c) => labels[c].trim() !== state.org.statusLabels[c]);
  const valid = STATUS_CATEGORIES.every((c) => labels[c].trim());

  const save = () => {
    const clean = Object.fromEntries(STATUS_CATEGORIES.map((c) => [c, labels[c].trim()])) as OrgSettings["statusLabels"];
    updateOrg({ statusLabels: clean });
    toast("Status names saved");
  };

  return (
    <div>
      <SectionTitle>Status names</SectionTitle>
      <HelpText>
        There are always five status categories. They drive progress and the review flow, so they can&apos;t be removed — but you can rename them to match your team&apos;s words (e.g. “Waiting for QC”).
      </HelpText>
      <Card className="divide-y divide-slate-100">
        {STATUS_CATEGORIES.map((c) => (
          <div key={c} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_16rem_10rem] sm:items-center">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{c.replace("_", " ")}</div>
              <div className="text-sm text-slate-600">{STATUS_HELP[c]}</div>
            </div>
            <input
              aria-label={`Display name for ${c.replace("_", " ")}`}
              className={inputCls}
              value={labels[c]}
              onChange={(e) => setLabels((l) => ({ ...l, [c]: e.target.value }))}
            />
            <div className="sm:text-right">
              {/* StatusPill reads saved labels; show the draft beside it until saved. */}
              <StatusPill status={c} />
              {labels[c].trim() !== state.org.statusLabels[c] && <span className="ml-2 text-xs text-amber-700">→ {labels[c] || "…"}</span>}
            </div>
          </div>
        ))}
        <div className="flex justify-end gap-2 px-4 py-3">
          {dirty && <Button variant="ghost" onClick={() => setLabels(state.org.statusLabels)}>Undo changes</Button>}
          <Button onClick={save} disabled={!dirty || !valid}>Save status names</Button>
        </div>
      </Card>
    </div>
  );
}

function ProgressSection() {
  const { state, terms, updateOrg } = usePreview();
  const { toast } = useToast();
  const mode = state.org.progressMode;
  const p = terms.project.one.toLowerCase();
  const t = terms.task.one.toLowerCase();
  const ts = terms.task.many.toLowerCase();
  const ss = terms.subtask.many.toLowerCase();

  const options: { value: OrgSettings["progressMode"]; label: string; hint: string }[] = [
    {
      value: "approved_tasks",
      label: `Count a ${t} only after the ${p} owner approves it (recommended)`,
      hint: "Progress only moves when finished work has been signed off. The most reliable number for managers.",
    },
    {
      value: "partial",
      label: `Also count approved ${ss} inside unfinished ${ts}`,
      hint: `Progress moves sooner, as each ${terms.subtask.one.toLowerCase()} is approved.`,
    },
  ];

  return (
    <div>
      <SectionTitle>Progress rule</SectionTitle>
      <Card className="space-y-3 p-4">
        <div role="radiogroup" aria-label="Progress rule" className="space-y-2">
          {options.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${
                mode === o.value ? "border-indigo-300 bg-indigo-50/60" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="progressMode"
                className="mt-0.5 accent-indigo-600"
                checked={mode === o.value}
                onChange={() => {
                  updateOrg({ progressMode: o.value });
                  toast("Progress rule saved");
                }}
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">{o.label}</span>
                <span className="block text-xs text-slate-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <strong className="text-slate-800">Example:</strong> a {p} has 4 {ts} of equal weight. One {t} is approved, and another has 2 of its 4 {ss} approved.
          With the recommended rule the {p} shows <strong className="text-slate-800">25%</strong> — only the signed-off {t} counts.
          With the second rule it shows <strong className="text-slate-800">37.5%</strong> — the half-finished {t} adds another 12.5%.
          Either way, work waiting for review never counts until it is approved.
        </p>
      </Card>
    </div>
  );
}
