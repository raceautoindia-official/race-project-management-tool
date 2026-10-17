"use client";

// Pieces shared by the platform (super-admin) console pages: plan catalogue,
// status badges, usage bars and the "live" view of a company record.

import { todayISO } from "@/lib/preview/engine";
import type { Company, CompanyStatus, PreviewState } from "@/lib/preview/types";

// ── Plans ──────────────────────────────────────────────────────────────────

export type PlanName = Company["plan"];
export const PLAN_NAMES: PlanName[] = ["Starter", "Business", "Enterprise"];

/** Sample price list — real pricing comes from the billing system later. */
export const PLANS: Record<PlanName, { price: number; seatLimit: number | null; blurb: string; features: string[] }> = {
  Starter: {
    price: 299,
    seatLimit: 10,
    blurb: "For small teams getting organised.",
    features: ["Up to 10 people", "Projects, tasks & subtasks", "Review & approval flow", "Email support"],
  },
  Business: {
    price: 599,
    seatLimit: 50,
    blurb: "For growing companies with several departments.",
    features: ["Up to 50 people", "Everything in Starter", "Man-hours & utilisation reports", "Custom fields & templates", "Excel import / export"],
  },
  Enterprise: {
    price: 899,
    seatLimit: null,
    blurb: "For large or multi-site organisations.",
    features: ["Unlimited people", "Everything in Business", "Single sign-on (SSO)", "Attendance / HR integration", "Dedicated success manager"],
  },
};

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// ── Status ─────────────────────────────────────────────────────────────────

export const STATUS_META: Record<CompanyStatus, { label: string; cls: string; dot: string }> = {
  active: { label: "Active", cls: "bg-green-50 text-green-700 ring-green-200", dot: "bg-green-500" },
  trial: { label: "Trial", cls: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500" },
  suspended: { label: "Suspended", cls: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  onboarding: { label: "Setting up", cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
};

export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden />
      {m.label}
    </span>
  );
}

export function PlanBadge({ plan }: { plan: PlanName }) {
  const cls =
    plan === "Enterprise" ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
    : plan === "Business" ? "bg-violet-50 text-violet-700 ring-violet-200"
    : "bg-slate-100 text-slate-700 ring-slate-200";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>{plan}</span>;
}

/** Users vs seats, turning amber when nearly full and red when over. */
export function SeatUsage({ users, seats, compact = false }: { users: number; seats: number; compact?: boolean }) {
  const ratio = seats > 0 ? users / seats : 0;
  const bar = ratio > 1 ? "bg-red-500" : ratio >= 0.85 ? "bg-amber-500" : "bg-indigo-500";
  return (
    <div className={compact ? "w-24" : "w-full"} title={`${users} of ${seats} seats used`}>
      <div className="mb-1 text-xs tabular-nums text-slate-700">
        <span className="font-medium">{users}</span>
        <span className="text-slate-400"> / {seats}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}

// ── Derived company facts ──────────────────────────────────────────────────

const TRIAL_DAYS = 14;

/** Days left on a trial (trials last 14 days from sign-up). Negative = expired. */
export function trialDaysLeft(c: Company): number {
  const end = new Date(c.createdAt + "T00:00:00");
  end.setDate(end.getDate() + TRIAL_DAYS);
  const today = new Date(todayISO() + "T00:00:00");
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}

export function daysSince(date: string): number {
  const from = new Date(date.length === 10 ? date + "T00:00:00" : date);
  return Math.max(0, Math.floor((Date.now() - from.getTime()) / 86400000));
}

/**
 * The demo tenant's numbers come from the real sample data (people, projects,
 * time logs) so they move as the reviewer clicks around; other tenants use the
 * figures stored on their company record.
 */
export function liveCompany(s: PreviewState, c: Company): Company {
  if (!c.isDemoTenant) return c;
  const month = todayISO().slice(0, 7);
  const hours = s.timeLogs.filter((l) => l.date.startsWith(month)).reduce((sum, l) => sum + l.hours, 0);
  return {
    ...c,
    users: s.people.length,
    activeProjects: s.projects.filter((p) => p.state === "active").length,
    hoursThisMonth: Math.round(hours),
  };
}

export function liveCompanies(s: PreviewState): Company[] {
  return s.companies.map((c) => liveCompany(s, c));
}

/** Small KPI tile used on the overview and billing pages. */
export function StatTile({ label, value, sub, tone = "slate" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" | "indigo" }) {
  const toneCls = {
    slate: "text-slate-900",
    green: "text-green-700",
    amber: "text-amber-700",
    red: "text-red-700",
    indigo: "text-indigo-700",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
