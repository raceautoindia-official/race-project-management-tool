"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatIst, istInputToUtc } from "@/lib/tz";
import {
  REMINDER_CATEGORIES,
  REMINDER_CATEGORY_LABELS,
  type Reminder,
} from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

const OFFSETS: { label: string; value: string }[] = [
  { label: "At the time", value: "0" },
  { label: "10 minutes before", value: "10" },
  { label: "30 minutes before", value: "30" },
  { label: "1 hour before", value: "60" },
  { label: "3 hours before", value: "180" },
  { label: "1 day before", value: "1440" },
  { label: "2 days before", value: "2880" },
  { label: "1 week before", value: "10080" },
];

const CATEGORY_COLOR: Record<string, string> = {
  payment: "bg-emerald-100 text-emerald-700",
  renewal: "bg-blue-100 text-blue-700",
  follow_up: "bg-amber-100 text-amber-700",
  meeting: "bg-violet-100 text-violet-700",
  general: "bg-slate-100 text-slate-600",
  custom: "bg-pink-100 text-pink-700",
};

function offsetLabel(min: number): string {
  const o = OFFSETS.find((x) => Number(x.value) === min);
  return o ? o.label : `${min} min before`;
}

export default function RemindersView({ initial }: { initial: Reminder[] }) {
  const { toast } = useToast();
  const [reminders, setReminders] = useState<Reminder[]>(initial);
  const [open, setOpen] = useState(false);

  const pending = reminders.filter((r) => !r.is_done);
  const done = reminders.filter((r) => r.is_done);

  async function toggleDone(r: Reminder) {
    try {
      const res = await apiFetch<{ reminder: Reminder }>(`/api/reminders/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDone: !r.is_done }),
      });
      setReminders((prev) => prev.map((x) => (x.id === r.id ? res.reminder : x)));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update", "error");
    }
  }
  async function remove(r: Reminder) {
    if (!confirm(`Delete reminder "${r.title}"?`)) return;
    try {
      await apiFetch(`/api/reminders/${r.id}`, { method: "DELETE" });
      setReminders((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          + New reminder
        </button>
      </div>

      <Section title="Upcoming" list={pending} onToggle={toggleDone} onRemove={remove} empty="No upcoming reminders." />
      {done.length > 0 && (
        <div className="mt-6">
          <Section title="Done" list={done} onToggle={toggleDone} onRemove={remove} muted />
        </div>
      )}

      {open && (
        <NewReminderModal
          onClose={() => setOpen(false)}
          onCreated={(r) => {
            setReminders((prev) =>
              [...prev, r].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
            );
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  list,
  onToggle,
  onRemove,
  empty,
  muted,
}: {
  title: string;
  list: Reminder[];
  onToggle: (r: Reminder) => void;
  onRemove: (r: Reminder) => void;
  empty?: string;
  muted?: boolean;
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-500">{title}</h2>
      {list.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          {empty}
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <div
              key={r.id}
              className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 ${
                muted ? "opacity-70" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={r.is_done}
                onChange={() => onToggle(r)}
                className="mt-1 h-4 w-4 rounded border-slate-300"
                title="Mark done"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      CATEGORY_COLOR[r.category] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {REMINDER_CATEGORY_LABELS[r.category] ?? r.category}
                  </span>
                  <span className={`font-semibold text-slate-900 ${r.is_done ? "line-through" : ""}`}>
                    {r.title}
                  </span>
                  {r.recurrence !== "none" && (
                    <span className="text-xs text-slate-400">↻ {r.recurrence}</span>
                  )}
                </div>
                <div className="mt-0.5 text-sm text-indigo-600">
                  {formatIst(r.scheduled_at)}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
                  <span>🔔 {offsetLabel(r.reminder_minutes)}</span>
                  {r.notify_email && <span>✉ email</span>}
                  {r.notify_push && <span>📱 push</span>}
                </div>
                {r.notes && <p className="mt-1 text-sm text-slate-600">{r.notes}</p>}
              </div>
              <button
                onClick={() => onRemove(r)}
                className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewReminderModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (r: Reminder) => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("payment");
  const [scheduledAt, setScheduledAt] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState("1440");
  const [recurrence, setRecurrence] = useState("none");
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyPush, setNotifyPush] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await apiFetch<{ reminder: Reminder }>("/api/reminders", {
        method: "POST",
        body: JSON.stringify({
          title,
          category,
          scheduledAt: istInputToUtc(scheduledAt),
          reminderMinutes: Number(reminderMinutes),
          recurrence,
          notifyEmail,
          notifyPush,
          notes,
        }),
      });
      onCreated(res.reminder);
      toast("Reminder scheduled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New reminder" widthClass="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">What</label>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="e.g. Pay AWS invoice" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              {REMINDER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {REMINDER_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">When</label>
            <input type="datetime-local" required value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Remind me</label>
            <select value={reminderMinutes} onChange={(e) => setReminderMinutes(e.target.value)} className={inputClass}>
              {OFFSETS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Repeat</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={inputClass}>
              <option value="none">Don’t repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Email
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={notifyPush} onChange={(e) => setNotifyPush(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Push (browser)
          </label>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Notes (optional)</label>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {busy ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
