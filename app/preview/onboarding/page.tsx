"use client";

// First-time setup for a new company admin, reached from the invite email.
// Full-screen (no app shell): six short steps, then into the workspace. In the
// preview the result is applied to the demo company (see completeOnboarding).

import { addDays, format } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePreview } from "@/lib/preview/store";
import { TERMINOLOGY_PRESETS } from "@/lib/preview/seed";
import { todayISO } from "@/lib/preview/engine";
import { Button, useNotConnected } from "@/components/preview/ui";
import { COUNTRIES, isEmail, suggestedDepartments } from "@/components/preview/onboarding/data";
import {
  AccountStep,
  CompanyStep,
  DoneStep,
  InviteStep,
  OrgStep,
  PASSWORD_RULES,
  TermsStep,
  blankInvite,
  ladderFor,
  presetFor,
  type Draft,
  type Errors,
} from "@/components/preview/onboarding/steps";

const STEPS = ["Your account", "Your company", "Naming", "Departments", "Invite team", "Finish"];

export default function OnboardingPage() {
  const { state, completeOnboarding, switchUser, createProject } = usePreview();
  const router = useRouter();
  const notConnected = useNotConnected();
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});

  // Pre-fill from the newest invited company, as the invite link would.
  const [draft, setDraft] = useState<Draft>(() => {
    const invited = state.companies.find((c) => c.status === "onboarding");
    const industry = TERMINOLOGY_PRESETS.some((p) => p.industry === invited?.industry) ? invited!.industry : TERMINOLOGY_PRESETS[0].industry;
    const country = COUNTRIES.find((c) => c.name === invited?.country) ?? COUNTRIES[0];
    return {
      name: invited?.adminName ?? "",
      email: invited?.adminEmail ?? "",
      password: "",
      confirm: "",
      companyName: invited?.name ?? "",
      industry,
      size: "",
      country: country.name,
      timezone: country.timezone,
      hoursPerDay: "8",
      workingDays: [1, 2, 3, 4, 5, 6],
      terms: presetFor(industry),
      termsTouched: false,
      departments: suggestedDepartments(industry),
      designations: ladderFor(industry),
      orgTouched: false,
      invites: [blankInvite(), blankInvite()],
      templateId: null,
    };
  });
  const invitedBy = state.platformAdmins[0]?.name;

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // Clear errors for whatever was just edited so they don't linger.
    if (Object.keys(errors).length) setErrors({});
  };

  const validate = (i: number): Errors => {
    const e: Errors = {};
    const d = draft;
    if (i === 0) {
      if (!d.name.trim()) e.name = "Please tell us your name.";
      if (!d.email.trim()) e.email = "We need your work email.";
      else if (!isEmail(d.email)) e.email = "That doesn't look like an email address — check for typos.";
      if (!d.password) e.password = "Choose a password.";
      else if (!PASSWORD_RULES[0].test(d.password)) e.password = "Use at least 8 characters.";
      else if (PASSWORD_RULES.filter((r) => r.test(d.password)).length < 3) e.password = "A bit stronger please — mix in capitals, numbers or symbols.";
      if (d.password && d.confirm !== d.password) e.confirm = "The two passwords don't match.";
    }
    if (i === 1) {
      if (!d.companyName.trim()) e.companyName = "What's your company called?";
      if (!d.size) e.size = "Pick the closest size.";
      const h = Number(d.hoursPerDay);
      if (!d.hoursPerDay || !Number.isFinite(h) || h <= 0 || h > 24) e.hoursPerDay = "Enter hours between 1 and 24.";
      if (d.workingDays.length === 0) e.workingDays = "Pick at least one working day.";
    }
    if (i === 2) {
      for (const k of ["project", "task", "subtask"] as const)
        for (const w of ["one", "many"] as const) if (!d.terms[k][w].trim()) e[`${k}.${w}`] = "This can't be empty.";
    }
    if (i === 3) {
      if (d.departments.length === 0) e.departments = "Add at least one department.";
      if (d.designations.length === 0) e.designations = "Add at least one designation.";
      const seen = new Set<string>();
      for (const g of d.designations) {
        const key = g.name.trim().toLowerCase();
        const lvl = Number(g.level);
        if (!key) e[`desig-${g.id}`] = "Give this level a name, or remove it.";
        else if (seen.has(key)) e[`desig-${g.id}`] = "This name is already used.";
        else if (!Number.isInteger(lvl) || lvl < 1) e[`desig-${g.id}`] = "Level must be a whole number from 1.";
        seen.add(key);
      }
    }
    if (i === 4) {
      const seen = new Set<string>([d.email.trim().toLowerCase()]);
      for (const r of d.invites) {
        if (!r.name.trim() && !r.email.trim()) continue; // empty rows are ignored
        if (!r.name.trim()) e[`inv-${r.id}-name`] = "Add their name.";
        const em = r.email.trim().toLowerCase();
        if (!em) e[`inv-${r.id}-email`] = "Add their email so we can invite them.";
        else if (!isEmail(em)) e[`inv-${r.id}-email`] = "That doesn't look like an email address.";
        else if (seen.has(em)) e[`inv-${r.id}-email`] = em === d.email.trim().toLowerCase() ? "That's your own email." : "This person is already in the list.";
        seen.add(em);
      }
    }
    return e;
  };

  const next = () => {
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    window.scrollTo({ top: 0 });
  };
  const back = () => {
    setErrors({});
    setStep((s) => Math.max(0, s - 1));
  };

  const finish = () => {
    const d = draft;
    completeOnboarding({
      adminName: d.name.trim(),
      adminEmail: d.email.trim(),
      companyName: d.companyName.trim(),
      industry: d.industry,
      country: d.country,
      timezone: d.timezone,
      terminology: {
        project: { one: d.terms.project.one.trim(), many: d.terms.project.many.trim() },
        task: { one: d.terms.task.one.trim(), many: d.terms.task.many.trim() },
        subtask: { one: d.terms.subtask.one.trim(), many: d.terms.subtask.many.trim() },
      },
      workingHoursPerDay: Number(d.hoursPerDay),
      workingDays: [...d.workingDays].sort((a, b) => a - b),
      departments: d.departments,
      designations: [...d.designations].map((g) => ({ name: g.name.trim(), level: Number(g.level) })).sort((a, b) => a.level - b.level),
      invites: d.invites
        .filter((r) => r.name.trim() && r.email.trim())
        .map((r) => ({ name: r.name.trim(), email: r.email.trim(), department: r.department, designation: r.designation })),
    });
    // In the preview you land in the demo company as its admin.
    switchUser("u-sanjay");
    const tpl = state.templates.find((t) => t.id === d.templateId);
    if (tpl) {
      createProject({
        name: tpl.name,
        description: tpl.description,
        ownerId: "u-sanjay",
        departmentId: null,
        startDate: todayISO(),
        dueDate: format(addDays(new Date(), 30), "yyyy-MM-dd"),
        expectedHours: null,
        memberIds: [],
        templateId: tpl.id,
      });
    }
    router.push("/preview");
  };

  const props = { draft, update, errors };
  const errorCount = Object.keys(errors).length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Same notice as the app shells */}
      <div className="bg-violet-700 px-4 py-1.5 text-center text-xs text-violet-50">
        <strong>Design preview</strong> — sample data only. Changes stay in this browser and are not saved to the server.
        Items marked <span className="rounded bg-white/15 px-1">⚡ Not connected yet</span> need the backend.
      </div>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">PM</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">Set up your workspace</p>
            {invitedBy && <p className="truncate text-xs text-slate-500">Invited by {invitedBy}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={notConnected("Saving your setup to finish later")}>Save & continue later</Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <Stepper step={step} onJump={(i) => i < step && setStep(i)} />

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (step < STEPS.length - 1) next();
            }}
          >
            {step === 0 && <AccountStep {...props} />}
            {step === 1 && <CompanyStep {...props} />}
            {step === 2 && <TermsStep {...props} />}
            {step === 3 && <OrgStep {...props} />}
            {step === 4 && (
              <InviteStep
                {...props}
                onSkip={() => {
                  update({ invites: [] });
                  setErrors({});
                  setStep(5);
                }}
              />
            )}
            {step === 5 && <DoneStep {...props} />}

            {errorCount > 0 && (
              <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                Please fix the {errorCount === 1 ? "highlighted field" : `${errorCount} highlighted fields`} above to continue.
              </p>
            )}

            <div className="mt-8 flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
              {step > 0 ? (
                <Button type="button" variant="secondary" onClick={back}>← Back</Button>
              ) : (
                <span className="text-xs text-slate-400">Takes about 3 minutes</span>
              )}
              {step < STEPS.length - 1 ? (
                <Button type="submit">Next: {STEPS[step + 1]} →</Button>
              ) : (
                <Button type="button" variant="success" onClick={finish}>Go to my workspace →</Button>
              )}
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Just looking? <Link href="/preview" className="text-indigo-600 hover:underline">Back to the demo workspace</Link>
        </p>
      </main>
    </div>
  );
}

function Stepper({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <nav aria-label="Setup progress">
      {/* Phones: compact bar */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-indigo-700">Step {step + 1} of {STEPS.length}</span>
          <span className="text-slate-500">{STEPS[step]}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>
      {/* Wider screens: numbered steps */}
      <ol className="hidden items-center sm:flex">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={label} className="flex flex-1 items-center last:flex-none">
              <button
                type="button"
                onClick={() => onJump(i)}
                disabled={!done}
                aria-current={current ? "step" : undefined}
                className="flex items-center gap-2 disabled:cursor-default"
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    done ? "bg-indigo-600 text-white" : current ? "bg-white text-indigo-700 ring-2 ring-indigo-600" : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className={`hidden text-xs font-medium md:inline ${current ? "text-slate-900" : "text-slate-500"}`}>{label}</span>
              </button>
              {i < STEPS.length - 1 && <span className={`mx-2 h-px flex-1 ${done ? "bg-indigo-600" : "bg-slate-200"}`} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
