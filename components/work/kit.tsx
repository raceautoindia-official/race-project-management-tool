"use client";

/**
 * components/work/kit.tsx — the redesign's shared pieces: the two-part
 * progress bar (approved / waiting for review), subtask status badges, date
 * ranges, schedule health, people with their job and department, and the
 * weight editor. Used by My Work, Reviews, the project tree and the task page
 * so they read as one system. Colours follow the timing-board palette in
 * app/globals.css (indigo = running, amber = review, green = done).
 */

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import Avatar from "@/components/Avatar";
import { useToast } from "@/components/ToastProvider";
import { apiFetch } from "@/lib/api-client";
import { rebalance, round1, scheduleHealth, type Health, type SubtaskStatus } from "@/lib/work-engine";
import { todayIST } from "@/lib/work-dates";

// ── Progress ───────────────────────────────────────────────────────────────

/**
 * Approved work is solid; finished work waiting for review is a striped amber
 * segment — finished, but it doesn't count yet.
 */
export function WorkProgress({
  approved,
  pending = 0,
  size = "md",
  showLabel = false,
  label = "Progress",
  className = "",
}: {
  approved: number;
  pending?: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  label?: string;
  className?: string;
}) {
  const a = Math.max(0, Math.min(100, approved));
  const p = Math.max(0, Math.min(100 - a, pending));
  const h = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";
  const title = `${Math.round(a)}% approved${p > 0.5 ? ` · ${Math.round(p)}% waiting for review (not counted yet)` : ""}`;
  return (
    <div className={`flex items-center gap-2 ${className}`} title={title}>
      <div
        className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${h}`}
        role="progressbar"
        aria-label={`${label}: ${title}`}
        aria-valuenow={Math.round(a)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full transition-all duration-500 ${a >= 99.5 ? "bg-green-500" : "bg-indigo-500"}`} style={{ width: `${a}%` }} />
        {p > 0 && (
          <div
            className="h-full bg-amber-300 transition-all duration-500"
            style={{ width: `${p}%`, backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.5) 0 4px, transparent 4px 8px)" }}
          />
        )}
      </div>
      {showLabel && <span className="figure w-10 shrink-0 text-right text-xs font-semibold text-slate-700">{Math.round(a)}%</span>}
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

// ── Subtask status ─────────────────────────────────────────────────────────

export const SUBTASK_STATUS_LABELS: Record<SubtaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "Waiting for review",
  done: "Approved",
  cancelled: "Cancelled",
};

const SUBTASK_STATUS_STYLES: Record<SubtaskStatus, string> = {
  todo: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  review: "bg-amber-50 text-amber-800 ring-amber-200",
  done: "bg-green-50 text-green-700 ring-green-200",
  cancelled: "bg-slate-50 text-slate-400 ring-slate-200 line-through",
};

export function SubtaskStatusBadge({ status }: { status: SubtaskStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SUBTASK_STATUS_STYLES[status]}`}>
      {SUBTASK_STATUS_LABELS[status]}
    </span>
  );
}

/** A small round marker for a subtask's state, for dense lists. */
export function StatusDot({ status }: { status: SubtaskStatus }) {
  const map: Record<SubtaskStatus, { cls: string; icon: string }> = {
    todo: { cls: "border-slate-300 bg-white text-transparent", icon: "·" },
    in_progress: { cls: "border-indigo-400 bg-indigo-50 text-indigo-600", icon: "◐" },
    review: { cls: "border-amber-400 bg-amber-50 text-amber-700", icon: "⧗" },
    done: { cls: "border-green-500 bg-green-500 text-white", icon: "✓" },
    cancelled: { cls: "border-slate-300 bg-slate-100 text-slate-400", icon: "–" },
  };
  const m = map[status];
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${m.cls}`} aria-hidden>
      {m.icon}
    </span>
  );
}

// ── Dates ──────────────────────────────────────────────────────────────────

export function shortDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function daysFromToday(d: string): number {
  const day = (x: string) => Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10));
  return Math.round((day(String(d).slice(0, 10)) - day(todayIST())) / 86_400_000);
}

/** "In 3 days", "Overdue 2d", "Due today"… for anything not finished. */
export function DueLabel({ date, finished = false }: { date: string | null | undefined; finished?: boolean }) {
  if (!date) return <span className="text-xs text-slate-400">No due date</span>;
  if (finished) return <span className="text-xs text-slate-500">{shortDate(date)}</span>;
  const n = daysFromToday(date);
  if (n < 0) return <span className="text-xs font-medium text-red-600" title={shortDate(date)}>Overdue {Math.abs(n)}d</span>;
  if (n === 0) return <span className="text-xs font-medium text-orange-600">Due today</span>;
  if (n === 1) return <span className="text-xs font-medium text-orange-600">Due tomorrow</span>;
  if (n <= 7) return <span className="text-xs text-slate-700" title={shortDate(date)}>In {n} days</span>;
  return <span className="text-xs text-slate-500">{shortDate(date)}</span>;
}

/** "12 Oct → 30 Oct" with the due-date urgency underneath. */
export function DateRange({
  start,
  due,
  finished = false,
  notStarted = false,
}: {
  start: string | null | undefined;
  due: string | null | undefined;
  finished?: boolean;
  notStarted?: boolean;
}) {
  const late = notStarted && !!start && daysFromToday(start) < 0;
  return (
    <span className="block leading-tight">
      <span className="block whitespace-nowrap text-xs text-slate-700">
        {shortDate(start)} <span className="text-slate-400">→</span> {shortDate(due)}
      </span>
      {late ? <span className="text-xs font-medium text-orange-600">Should have started</span> : <DueLabel date={due} finished={finished} />}
    </span>
  );
}

// ── Health ─────────────────────────────────────────────────────────────────

const HEALTH: Record<Health, { label: string; cls: string; hint: string }> = {
  on_track: { label: "On track", cls: "bg-green-50 text-green-700 ring-green-200", hint: "Approved progress is keeping up with the schedule." },
  at_risk: { label: "At risk", cls: "bg-amber-50 text-amber-800 ring-amber-200", hint: "More than 10 points behind where the schedule says it should be." },
  off_track: { label: "Off track", cls: "bg-red-50 text-red-700 ring-red-200", hint: "More than 25 points behind schedule." },
  not_started: { label: "Not started", cls: "bg-slate-100 text-slate-600 ring-slate-200", hint: "The start date is still ahead." },
  done: { label: "Complete", cls: "bg-green-50 text-green-700 ring-green-200", hint: "All work is approved." },
  no_dates: { label: "No dates", cls: "bg-slate-50 text-slate-500 ring-slate-200", hint: "Set a start and due date to see whether it is on schedule." },
};

export function HealthBadge({ approved, start, due }: { approved: number; start: string | null | undefined; due: string | null | undefined }) {
  const { health, expected } = scheduleHealth(approved, start ? String(start).slice(0, 10) : null, due ? String(due).slice(0, 10) : null, todayIST());
  const h = HEALTH[health];
  const title = expected !== null && (health === "on_track" || health === "at_risk" || health === "off_track")
    ? `${h.hint} Expected by today: ${Math.round(expected)}%.`
    : h.hint;
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${h.cls}`}>
      {h.label}
    </span>
  );
}

// ── People ─────────────────────────────────────────────────────────────────

/** A person with their job title and department underneath. */
export function PersonLine({
  name,
  designation,
  department,
  size = "sm",
  empty = "Unassigned",
}: {
  name: string | null | undefined;
  designation?: string | null;
  department?: string | null;
  size?: "sm" | "md";
  empty?: string;
}) {
  if (!name) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
        ○ {empty}
      </span>
    );
  }
  const sub = [designation, department].filter(Boolean).join(" · ");
  return (
    <span className="inline-flex min-w-0 items-center gap-2" title={sub ? `${name} — ${sub}` : name}>
      <Avatar name={name} size={size} />
      <span className="min-w-0 leading-tight">
        <span className={`block truncate font-medium text-slate-800 ${size === "sm" ? "text-xs" : "text-sm"}`}>{name}</span>
        {sub && <span className="block truncate text-xs text-slate-500">{sub}</span>}
      </span>
    </span>
  );
}

export interface PickPerson {
  user_id: number;
  name: string;
  department?: string | null;
  designation?: string | null;
}

/** People picker grouped by department, each option showing the job title. */
export function PersonSelect({
  people,
  value,
  onChange,
  emptyLabel = "Unassigned",
  allowEmpty = true,
  className = "",
  id,
  label,
}: {
  people: PickPerson[];
  value: number | null;
  onChange: (id: number | null) => void;
  emptyLabel?: string;
  allowEmpty?: boolean;
  className?: string;
  id?: string;
  label?: string;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, PickPerson[]>();
    for (const p of [...people].sort((a, b) => a.name.localeCompare(b.name))) {
      const key = p.department || "No department";
      m.set(key, [...(m.get(key) ?? []), p]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "No department" ? 1 : b === "No department" ? -1 : a.localeCompare(b)));
  }, [people]);
  return (
    <select
      id={id}
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${className}`}
    >
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {groups.map(([dept, list]) => (
        <optgroup key={dept} label={dept}>
          {list.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.name}
              {p.designation ? ` — ${p.designation}` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ── Weights ────────────────────────────────────────────────────────────────

export function weightLabel(n: number): string {
  const r = round1(n);
  return `${Number.isInteger(r) ? r : r.toFixed(1)}%`;
}

/** A weight that owners can click to open the editor. */
export function WeightChip({ value, canEdit, onEdit, title }: { value: number; canEdit: boolean; onEdit: () => void; title: string }) {
  if (!canEdit) {
    return (
      <span className="figure text-sm text-slate-600" title={`${title} Only the owner can change it.`}>
        {weightLabel(value)}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      className="figure inline-flex items-center gap-1 rounded-md border border-dashed border-indigo-300 px-1.5 py-0.5 text-sm text-indigo-700 hover:border-indigo-500 hover:bg-indigo-50"
      title={`${title} Click to adjust.`}
    >
      {weightLabel(value)} <span className="text-[10px]" aria-hidden>✎</span>
    </button>
  );
}

export interface WeightItem {
  id: number;
  title: string;
  who?: string | null;
  weight: number; // effective %
  auto: boolean;
}

/**
 * The weight editor. Changing one item rebalances the others so the total is
 * always 100% (lib/work-engine.ts rebalance); changed items are locked so the
 * next change doesn't move them. "Reset to even split" saves automatic
 * weights that keep rebalancing as items are added.
 */
export function WeightEditor({
  open,
  onClose,
  items,
  parentLabel,
  endpoint,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  items: WeightItem[];
  parentLabel: string;
  /** PUT target, e.g. /api/tasks/5/subtasks/weights */
  endpoint: string;
  onSaved: () => void;
}) {
  return open ? <WeightEditorBody onClose={onClose} items={items} parentLabel={parentLabel} endpoint={endpoint} onSaved={onSaved} /> : null;
}

function WeightEditorBody({
  onClose,
  items,
  parentLabel,
  endpoint,
  onSaved,
}: {
  onClose: () => void;
  items: WeightItem[];
  parentLabel: string;
  endpoint: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(() => items.map((i) => ({ id: i.id, weight: round1(i.weight), locked: false })));
  const [even, setEven] = useState(() => items.every((i) => i.auto));
  const [saving, setSaving] = useState(false);
  const total = round1(draft.reduce((s, d) => s + d.weight, 0));

  const setOne = (id: number, value: number) => {
    setEven(false);
    setDraft((ds) => rebalance(ds, id, value));
  };

  async function save() {
    setSaving(true);
    try {
      await apiFetch(endpoint, {
        method: "PUT",
        body: JSON.stringify(even ? { reset: true } : { weights: draft.map((d) => ({ id: d.id, weight: d.weight })) }),
      });
      toast("Weights saved — progress recalculated");
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the weights", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Adjust weights — ${parentLabel}`} widthClass="max-w-2xl">
      <p className="mb-1 text-sm text-slate-600">
        Weight is how much each item counts toward <strong>{parentLabel}</strong>&apos;s progress. Drag a slider or type a number;
        the others adjust automatically so the total always stays at <strong>100%</strong>.
      </p>
      <p className="mb-4 text-xs text-slate-500">🔒 Items you change are locked so they don&apos;t move when you adjust the next one. Click the lock to release it.</p>
      <div className="space-y-3">
        {draft.map((d) => {
          const item = items.find((i) => i.id === d.id)!;
          return (
            <div key={d.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_200px_120px]">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{item.title}</p>
                <p className="text-xs text-slate-500">{item.who ?? "Unassigned"}</p>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={d.weight}
                onChange={(e) => setOne(d.id, Number(e.target.value))}
                className="order-3 col-span-2 w-full accent-indigo-600 sm:order-none sm:col-span-1"
                aria-label={`Weight for ${item.title}`}
              />
              <div className="flex items-center justify-end gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={d.weight}
                  onChange={(e) => setOne(d.id, Number(e.target.value))}
                  className="figure w-16 rounded border border-slate-300 px-1.5 py-1 text-right text-sm"
                  aria-label={`Weight % for ${item.title}`}
                />
                <span className="text-xs text-slate-400">%</span>
                <button
                  type="button"
                  onClick={() => setDraft((ds) => ds.map((x) => (x.id === d.id ? { ...x, locked: !x.locked } : x)))}
                  className={`rounded px-1 text-sm ${d.locked ? "opacity-100" : "opacity-30 hover:opacity-60"}`}
                  title={d.locked ? "Locked — click to let it adjust" : "Click to lock this value"}
                  aria-label={d.locked ? `Unlock ${item.title}` : `Lock ${item.title}`}
                >
                  {d.locked ? "🔒" : "🔓"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Total: <strong className="figure text-green-700">{weightLabel(total)}</strong>
        {even && <span className="ml-2 text-xs text-slate-500">(even split — new items will share automatically)</span>}
      </div>
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setEven(true);
            setDraft((ds) => ds.map((d) => ({ ...d, weight: round1(100 / ds.length), locked: false })));
          }}
          className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          ↺ Reset to even split
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save weights"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
