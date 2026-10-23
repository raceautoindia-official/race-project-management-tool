"use client";

// Platform audit log: who did what at the platform level. In the preview this
// is sample events plus ones derived from the company list; the real log will
// be written by the backend and cannot be edited.

import { useState } from "react";
import { usePreview } from "@/lib/preview/store";
import type { Company } from "@/lib/preview/types";
import { Button, Card, EmptyState, NotConnectedTag, PageHeader, inputCls, timeAgo, useNotConnected } from "@/components/preview/ui";

type Kind = "created" | "invite" | "plan" | "impersonation" | "suspended" | "reactivated" | "security";

interface AuditEvent {
  id: string;
  kind: Kind;
  at: string; // ISO
  actor: string;
  company: string | null;
  text: string;
  detail?: string;
}

const KIND_META: Record<Kind, { label: string; icon: string; cls: string }> = {
  created: { label: "Company created", icon: "＋", cls: "bg-green-50 text-green-700" },
  invite: { label: "Invite sent", icon: "✉", cls: "bg-sky-50 text-sky-700" },
  plan: { label: "Plan changed", icon: "₹", cls: "bg-violet-50 text-violet-700" },
  impersonation: { label: "Impersonation", icon: "🕵", cls: "bg-amber-50 text-amber-800" },
  suspended: { label: "Company suspended", icon: "⛔", cls: "bg-red-50 text-red-700" },
  reactivated: { label: "Company reactivated", icon: "↺", cls: "bg-green-50 text-green-700" },
  security: { label: "Security setting", icon: "🔐", cls: "bg-slate-100 text-slate-700" },
};

const hoursAgo = (now: number, h: number) => new Date(now - h * 3600000).toISOString();

/** Hand-written sample events, plus events implied by each company's record. */
function buildEvents(companies: Company[], superName: string, now: number): AuditEvent[] {
  const events: AuditEvent[] = [
    { id: "ev1", kind: "impersonation", at: hoursAgo(now, 3), actor: superName, company: "Sunrise Constructions", text: "started impersonating Ramesh Iyer (company admin)", detail: "Reason: support ticket #4821 — Gantt export not loading" },
    { id: "ev2", kind: "impersonation", at: hoursAgo(now, 2.6), actor: superName, company: "Sunrise Constructions", text: "ended impersonation session (24 minutes)" },
    { id: "ev3", kind: "plan", at: hoursAgo(now, 30), actor: superName, company: "Kaveri Auto Components", text: "changed plan from Business to Enterprise", detail: "Seats raised from 50 to 250" },
    { id: "ev4", kind: "security", at: hoursAgo(now, 52), actor: superName, company: null, text: "made two-step sign-in required for company admins" },
    { id: "ev5", kind: "impersonation", at: hoursAgo(now, 75), actor: superName, company: "Demo Company Pvt. Ltd.", text: "started impersonating Sanjay Kumar (company admin)", detail: "Reason: onboarding walkthrough with the client" },
    { id: "ev6", kind: "plan", at: hoursAgo(now, 200), actor: "Omar Haddad", company: "Pixel & Pine Agency", text: "started a 14-day trial on the Starter plan" },
  ];
  for (const c of companies) {
    const created = new Date(c.createdAt + "T09:30:00").toISOString();
    events.push({ id: `${c.id}-created`, kind: "created", at: created, actor: superName, company: c.name, text: `added the company (${c.plan}, ${c.seats} seats)` });
    events.push({ id: `${c.id}-invite`, kind: "invite", at: created, actor: "System", company: c.name, text: `sent the admin invite to ${c.adminName} (${c.adminEmail})` });
    if (c.status === "suspended")
      events.push({ id: `${c.id}-susp`, kind: "suspended", at: c.lastActiveAt, actor: superName, company: c.name, text: "suspended the company", detail: "Reason: invoice overdue by 30 days" });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export default function AuditPage() {
  const { state } = usePreview();
  const notConnected = useNotConnected();
  const superName = state.platformAdmins[0]?.name ?? "Super admin";
  // Snapshot "now" once so the sample times don't shift on every render.
  const [now] = useState(() => Date.now());
  const [kind, setKind] = useState<Kind | "all">("all");
  const [q, setQ] = useState("");

  const all = buildEvents(state.companies, superName, now);
  const term = q.trim().toLowerCase();
  const events = all.filter(
    (e) => (kind === "all" || e.kind === kind) && (!term || [e.actor, e.company ?? "", e.text, e.detail ?? ""].some((v) => v.toLowerCase().includes(term)))
  );

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle={<span className="flex flex-wrap items-center gap-2">Every platform-level action, newest first. Entries can&apos;t be edited or deleted. <NotConnectedTag label="Sample events" /></span>}
        actions={<Button variant="secondary" onClick={notConnected("Exporting the audit log")}>Export</Button>}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by person, company or action…" className={`${inputCls} sm:max-w-sm`} aria-label="Search the audit log" />
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind | "all")} className={`${inputCls} sm:w-56`} aria-label="Filter by event type">
          <option value="all">All events ({all.length})</option>
          {(Object.keys(KIND_META) as Kind[]).map((k) => (
            <option key={k} value={k}>{KIND_META[k].label} ({all.filter((e) => e.kind === k).length})</option>
          ))}
        </select>
      </div>

      {events.length === 0 ? (
        <EmptyState icon="🗒" title="No events match" body="Try a different search or event type." />
      ) : (
        <Card className="divide-y divide-slate-100">
          {events.map((e) => {
            const m = KIND_META[e.kind];
            return (
              <div key={e.id} className="flex gap-3 px-4 py-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${m.cls}`} aria-hidden>{m.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800">
                    <strong className="font-medium text-slate-900">{e.actor}</strong> {e.text}
                    {e.company && <span className="text-slate-500"> · {e.company}</span>}
                  </p>
                  {e.detail && <p className="mt-0.5 text-xs text-slate-500">{e.detail}</p>}
                  <p className="mt-0.5 text-xs text-slate-400">
                    {m.label} · <span title={new Date(e.at).toLocaleString("en-IN")}>{timeAgo(e.at)}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
