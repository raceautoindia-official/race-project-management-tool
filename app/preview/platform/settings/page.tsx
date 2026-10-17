"use client";

// Platform-wide defaults every new company starts from: templates, naming
// presets and security rules, plus how company data is kept apart. Changes
// here are kept on this page only (they are not saved yet).

import { useState } from "react";
import { usePreview } from "@/lib/preview/store";
import { TERMINOLOGY_PRESETS } from "@/lib/preview/seed";
import { Button, Card, NotConnectedTag, PageHeader, SectionTitle, inputCls, labelCls } from "@/components/preview/ui";
import { HelpText, Toggle } from "@/components/preview/admin/shared";
import { useToast } from "@/components/ToastProvider";

export default function PlatformSettingsPage() {
  const { state } = usePreview();
  const { toast } = useToast();
  const [enabledTemplates, setEnabledTemplates] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(state.templates.map((t) => [t.id, true]))
  );
  const [enabledPresets, setEnabledPresets] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(TERMINOLOGY_PRESETS.map((p) => [p.industry, true]))
  );
  const [security, setSecurity] = useState({
    minLength: 10,
    requireMixed: true,
    require2fa: false,
    adminsNeed2fa: true,
    sessionHours: 12,
    lockAfter: 5,
  });
  const setSec = <K extends keyof typeof security>(k: K, v: (typeof security)[K]) => setSecurity((s) => ({ ...s, [k]: v }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Platform settings"
        subtitle="Defaults that every new company starts with. Each company can change its own copy later."
        actions={<Button onClick={() => toast("Settings kept for this preview session. Saving to the server comes with the backend.", "info")}>Save changes</Button>}
      />

      <section>
        <SectionTitle count={state.templates.length}>Starter templates for new companies</SectionTitle>
        <HelpText>Switch off a template to hide it from companies that join from now on. Companies that already use it keep it.</HelpText>
        <Card className="divide-y divide-slate-100">
          {state.templates.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{t.name}</p>
                <p className="text-xs text-slate-500">{t.industry} · {t.tasks.length} tasks, {t.tasks.reduce((n, x) => n + x.subtasks.length, 0)} subtasks — {t.description}</p>
              </div>
              <Toggle
                label={`Offer ${t.name} to new companies`}
                checked={enabledTemplates[t.id] ?? true}
                onChange={(v) => setEnabledTemplates((m) => ({ ...m, [t.id]: v }))}
              />
            </div>
          ))}
        </Card>
      </section>

      <section>
        <SectionTitle count={TERMINOLOGY_PRESETS.length}>Naming presets by industry</SectionTitle>
        <HelpText>During setup, a company picks its industry and gets these names for its three levels of work. They can rename them at any time.</HelpText>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TERMINOLOGY_PRESETS.map((p) => (
            <Card key={p.industry} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-900">{p.industry}</p>
                <Toggle
                  label={`Offer the ${p.industry} preset`}
                  checked={enabledPresets[p.industry] ?? true}
                  onChange={(v) => setEnabledPresets((m) => ({ ...m, [p.industry]: v }))}
                />
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {p.terms.project.one} <span className="text-slate-400">›</span> {p.terms.task.one} <span className="text-slate-400">›</span> {p.terms.subtask.one}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle action={<NotConnectedTag label="Login rules not connected yet" />}>Security defaults</SectionTitle>
        <HelpText>These rules apply to sign-in for every company. They take effect once real accounts and logins are built.</HelpText>
        <Card className="divide-y divide-slate-100">
          <SettingRow title="Minimum password length" body="Longer passwords are much harder to guess.">
            <select value={security.minLength} onChange={(e) => setSec("minLength", Number(e.target.value))} className={`${inputCls} w-32`} aria-label="Minimum password length">
              {[8, 10, 12, 14].map((n) => <option key={n} value={n}>{n} characters</option>)}
            </select>
          </SettingRow>
          <SettingRow title="Require letters, numbers and a symbol" body="Passwords must mix upper and lower case, a number and a symbol.">
            <Toggle label="Require mixed characters" checked={security.requireMixed} onChange={(v) => setSec("requireMixed", v)} />
          </SettingRow>
          <SettingRow title="Two-step sign-in for company admins" body="Admins confirm each new sign-in with a code from their phone.">
            <Toggle label="Require 2FA for admins" checked={security.adminsNeed2fa} onChange={(v) => setSec("adminsNeed2fa", v)} />
          </SettingRow>
          <SettingRow title="Two-step sign-in for everyone" body="Every person at every company must use a phone code.">
            <Toggle label="Require 2FA for everyone" checked={security.require2fa} onChange={(v) => setSec("require2fa", v)} />
          </SettingRow>
          <SettingRow title="Sign people out after" body="How long someone stays signed in without using the app.">
            <select value={security.sessionHours} onChange={(e) => setSec("sessionHours", Number(e.target.value))} className={`${inputCls} w-32`} aria-label="Session timeout">
              {[1, 4, 8, 12, 24, 72].map((n) => <option key={n} value={n}>{n} hour{n === 1 ? "" : "s"}</option>)}
            </select>
          </SettingRow>
          <SettingRow title="Lock the account after" body="Wrong password attempts before the account is locked for 15 minutes.">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="number" min={3} max={10} value={security.lockAfter} onChange={(e) => setSec("lockAfter", Number(e.target.value) || 5)} className={`${inputCls} w-20`} aria-label="Failed attempts before lock" />
              tries
            </label>
          </SettingRow>
        </Card>
      </section>

      <section>
        <SectionTitle>How company data is kept apart</SectionTitle>
        <Card className="p-5">
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex gap-3"><span aria-hidden>🔐</span><span><strong>Each company&apos;s data is separated.</strong> People at one company can never see another company&apos;s projects, people or files.</span></li>
            <li className="flex gap-3"><span aria-hidden>🕵️</span><span><strong>Super admins only enter a workspace through audited impersonation.</strong> Every visit is recorded in the audit log with who, when and why.</span></li>
            <li className="flex gap-3"><span aria-hidden>📊</span><span><strong>This console shows totals only</strong> — seats, hours and project counts — never the content of a company&apos;s work.</span></li>
            <li className="flex gap-3"><span aria-hidden>🗄️</span><span><strong>Suspending a company keeps its data.</strong> Deleting data is a separate step that needs the company admin&apos;s written request.</span></li>
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
            <NotConnectedTag label="Data separation not connected yet" />
            In this preview every company shares the same sample data in your browser.
          </div>
          <div className="mt-4">
            <label className="block max-w-sm">
              <span className={labelCls}>Impersonation needs a reason</span>
              <select defaultValue="required" className={inputCls}>
                <option value="required">Always ask for a reason (recommended)</option>
                <option value="optional">Reason is optional</option>
              </select>
            </label>
          </div>
        </Card>
      </section>
    </div>
  );
}

function SettingRow({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{body}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
