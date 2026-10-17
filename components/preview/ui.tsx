"use client";

// Shared building blocks for the redesigned frontend preview.

import Link from "next/link";
import { useEffect } from "react";
import Avatar from "@/components/Avatar";
import { useToast } from "@/components/ToastProvider";
import { labelChipClass } from "@/lib/colors";
import { usePreview } from "@/lib/preview/store";
import { daysUntil, personById, pct, type Health, type Progress } from "@/lib/preview/engine";
import type { Priority, StatusCategory } from "@/lib/preview/types";

// ── Form styling (plain class strings so every page looks the same) ─────────

export const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100";
export const labelCls = "mb-1 block text-sm font-medium text-slate-700";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

// ── Buttons ────────────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "border border-red-200 bg-white text-red-600 hover:bg-red-50",
  success: "bg-green-600 text-white hover:bg-green-700 shadow-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${sz} ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function ButtonLink({ href, children, variant = "primary", className = "" }: { href: string; children: React.ReactNode; variant?: Variant; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

// ── Layout ─────────────────────────────────────────────────────────────────

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions, crumbs }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: { href: string; label: string }[];
}) {
  return (
    <div className="mb-6">
      {crumbs && crumbs.length > 0 && (
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm text-slate-500" aria-label="Breadcrumb">
          {crumbs.map((c) => (
            <span key={c.href} className="flex items-center gap-1">
              <Link href={c.href} className="hover:text-indigo-600 hover:underline">{c.label}</Link>
              <span aria-hidden>›</span>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({ children, count, action }: { children: React.ReactNode; count?: number; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        {children}
        {count !== undefined && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{count}</span>
        )}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon = "✨", title, body, action }: { icon?: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center">
      <div className="text-3xl" aria-hidden>{icon}</div>
      <p className="mt-2 font-medium text-slate-800">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
            value === t.key ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Right-hand slide-over panel. */
export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-slate-200 px-5 py-3">{footer}</div>}
      </aside>
    </div>
  );
}

// ── Status, priority, health, dates ────────────────────────────────────────

const STATUS_STYLE: Record<StatusCategory, string> = {
  not_started: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-blue-50 text-blue-700 ring-blue-200",
  in_review: "bg-amber-50 text-amber-800 ring-amber-200",
  done: "bg-green-50 text-green-700 ring-green-200",
  cancelled: "bg-slate-50 text-slate-400 ring-slate-200 line-through",
};
const STATUS_DOT: Record<StatusCategory, string> = {
  not_started: "bg-slate-400",
  in_progress: "bg-blue-500",
  in_review: "bg-amber-500",
  done: "bg-green-500",
  cancelled: "bg-slate-300",
};

export function StatusPill({ status }: { status: StatusCategory }) {
  const { statusLabel } = usePreview();
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {statusLabel(status)}
    </span>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  low: "text-slate-500",
  medium: "text-sky-700",
  high: "text-orange-600",
  urgent: "text-red-600 font-semibold",
};
const PRIORITY_ICON: Record<Priority, string> = { low: "↓", medium: "→", high: "↑", urgent: "⚑" };

export function PriorityTag({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs capitalize ${PRIORITY_STYLE[priority]}`} title={`Priority: ${priority}`}>
      <span aria-hidden>{PRIORITY_ICON[priority]}</span>
      {priority}
    </span>
  );
}

const HEALTH: Record<Health, { label: string; cls: string; hint: string }> = {
  on_track: { label: "On track", cls: "bg-green-50 text-green-700 ring-green-200", hint: "Progress is keeping up with the schedule." },
  at_risk: { label: "At risk", cls: "bg-amber-50 text-amber-800 ring-amber-200", hint: "More than 10 points behind where the schedule says it should be." },
  off_track: { label: "Off track", cls: "bg-red-50 text-red-700 ring-red-200", hint: "More than 25 points behind schedule." },
  not_started: { label: "Not started", cls: "bg-slate-100 text-slate-600 ring-slate-200", hint: "The start date is in the future." },
  done: { label: "Complete", cls: "bg-green-50 text-green-700 ring-green-200", hint: "All work approved." },
};

export function HealthBadge({ health, expected }: { health: Health; expected?: number }) {
  const h = HEALTH[health];
  const title = expected !== undefined && health !== "done" && health !== "not_started" ? `${h.hint} Expected by today: ${pct(expected)}.` : h.hint;
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${h.cls}`}>
      {h.label}
    </span>
  );
}

export function DueLabel({ date, status }: { date: string | null; status?: StatusCategory }) {
  if (!date) return <span className="text-xs text-slate-400">No due date</span>;
  const n = daysUntil(date);
  const closed = status === "done" || status === "cancelled";
  const pretty = new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (closed) return <span className="text-xs text-slate-500">{pretty}</span>;
  if (n < 0) return <span className="text-xs font-medium text-red-600" title={pretty}>Overdue {Math.abs(n)}d</span>;
  if (n === 0) return <span className="text-xs font-medium text-orange-600">Due today</span>;
  if (n === 1) return <span className="text-xs font-medium text-orange-600">Due tomorrow</span>;
  if (n <= 7) return <span className="text-xs text-slate-700" title={pretty}>In {n} days</span>;
  return <span className="text-xs text-slate-500">{pretty}</span>;
}

/** "12 Oct → 30 Oct" with the due-date urgency underneath. */
export function DateRange({ start, due, status }: { start: string | null; due: string | null; status?: StatusCategory }) {
  const short = (x: string | null) => (x ? new Date(x + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—");
  const notStartedLate = status === "not_started" && !!start && daysUntil(start) < 0;
  return (
    <span className="block leading-tight">
      <span className="block text-xs text-slate-700" title={`Start ${short(start)} · Due ${short(due)}`}>
        {short(start)} <span className="text-slate-400">→</span> {short(due)}
      </span>
      {notStartedLate ? <span className="text-xs font-medium text-orange-600">Should have started</span> : <DueLabel date={due} status={status} />}
    </span>
  );
}

export function fmtDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

// ── Progress ───────────────────────────────────────────────────────────────

/**
 * Approved work is solid; work waiting for review is a striped amber segment,
 * so people can see it is finished but does not count yet.
 */
export function ProgressBar({ value, size = "md", showLabel = false, className = "" }: { value: Progress; size?: "sm" | "md" | "lg"; showLabel?: boolean; className?: string }) {
  const a = Math.max(0, Math.min(100, value.approved));
  const p = Math.max(0, Math.min(100 - a, value.pending));
  const h = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";
  const title = `${pct(a)} approved${p > 0 ? ` · ${pct(p)} waiting for review (not counted yet)` : ""}`;
  return (
    <div className={`flex items-center gap-2 ${className}`} title={title}>
      <div className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${h}`} role="progressbar" aria-valuenow={Math.round(a)} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
        <div className={`h-full transition-all duration-700 ${a >= 99.5 ? "bg-green-500" : "bg-indigo-500"}`} style={{ width: `${a}%` }} />
        {p > 0 && (
          <div
            className="h-full bg-amber-300 transition-all duration-700"
            style={{ width: `${p}%`, backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.45) 0 4px, transparent 4px 8px)" }}
          />
        )}
      </div>
      {showLabel && <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">{pct(a)}</span>}
    </div>
  );
}

export function ProgressLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-indigo-500" /> Approved (counts)</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-amber-300" /> Waiting for review (doesn&apos;t count yet)</span>
    </div>
  );
}

// ── People ─────────────────────────────────────────────────────────────────

export function usePersonMeta() {
  const { state } = usePreview();
  return (id: string | null | undefined) => {
    const p = personById(state, id);
    if (!p) return null;
    const dept = state.departments.find((d) => d.id === p.departmentId) ?? null;
    const desig = state.designations.find((g) => g.id === p.designationId) ?? null;
    return { person: p, dept, desig, subtitle: [desig?.name, dept?.name].filter(Boolean).join(" · ") };
  };
}

export function PersonChip({ id, size = "sm", showSubtitle = false, emptyLabel = "Unassigned" }: { id: string | null; size?: "sm" | "md"; showSubtitle?: boolean; emptyLabel?: string }) {
  const meta = usePersonMeta()(id);
  if (!meta) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
        <span aria-hidden>○</span> {emptyLabel}
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-2" title={`${meta.person.name}${meta.subtitle ? ` — ${meta.subtitle}` : ""}`}>
      <Avatar name={meta.person.name} size={size} />
      <span className="min-w-0 leading-tight">
        <span className={`block truncate ${size === "sm" ? "text-xs" : "text-sm"} font-medium text-slate-800`}>{meta.person.name}</span>
        {showSubtitle && meta.subtitle && <span className="block truncate text-xs text-slate-500">{meta.subtitle}</span>}
      </span>
    </span>
  );
}

export function DeptBadge({ id }: { id: string | null }) {
  const { state } = usePreview();
  const d = state.departments.find((x) => x.id === id);
  if (!d) return null;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${labelChipClass(d.color)}`}>{d.name}</span>;
}

/** People picker grouped by department, showing each person's designation. */
export function PersonSelect({ value, onChange, allowEmpty = true, emptyLabel = "Unassigned", restrictTo, className = "", id }: {
  value: string | null;
  onChange: (id: string | null) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  restrictTo?: string[];
  className?: string;
  id?: string;
}) {
  const { state } = usePreview();
  const people = state.people.filter((p) => !restrictTo || restrictTo.includes(p.id));
  const groups = [...state.departments, { id: "__none", name: "No department", color: "slate" }]
    .map((d) => ({ d, list: people.filter((p) => (p.departmentId ?? "__none") === d.id) }))
    .filter((g) => g.list.length > 0);
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={`${inputCls} ${className}`}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {groups.map(({ d, list }) => (
        <optgroup key={d.id} label={d.name}>
          {list.map((p) => {
            const g = state.designations.find((x) => x.id === p.designationId);
            return (
              <option key={p.id} value={p.id}>
                {p.name}{g ? ` — ${g.name}` : ""}
              </option>
            );
          })}
        </optgroup>
      ))}
    </select>
  );
}

// ── "Not connected yet" markers ────────────────────────────────────────────

/** Small tag marking a control that needs the backend before it really works. */
export function NotConnectedTag({ label = "Not connected yet" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200" title="This works in the preview only — it will be wired to the backend after approval.">
      <span aria-hidden>⚡</span> {label}
    </span>
  );
}

/** Returns a click handler that explains the feature is pending backend work. */
export function useNotConnected() {
  const { toast } = useToast();
  return (feature: string) => () => toast(`${feature} — not connected to the backend yet. It will work once the backend is built.`, "info");
}
