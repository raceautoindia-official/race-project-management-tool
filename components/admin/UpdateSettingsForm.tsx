"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import type { UpdateSettings, Slot } from "@/lib/work-updates";

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/** When work-update reminders go out, and how. */
export default function UpdateSettingsForm({ initial }: { initial: UpdateSettings }) {
  const { toast } = useToast();
  const [s, setS] = useState<UpdateSettings>(initial);
  const [busy, setBusy] = useState(false);

  const slot = (key: "dailyReminder" | "weeklyPlanReminder" | "weeklySummaryReminder" | "adminDigest", label: string, when: string) => {
    const v: Slot = s[key];
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-slate-200">
        <label className="flex min-w-0 flex-1 items-center gap-3">
          <input
            type="checkbox"
            checked={v.on}
            onChange={(e) => setS({ ...s, [key]: { ...v, on: e.target.checked } })}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">{label}</span>
            <span className="block text-xs text-slate-500">{when}</span>
          </span>
        </label>
        <input
          type="time"
          aria-label={`${label} time`}
          value={v.time}
          disabled={!v.on}
          onChange={(e) => setS({ ...s, [key]: { ...v, time: e.target.value } })}
          className={`${inputClass} disabled:opacity-50`}
        />
      </div>
    );
  };

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (s.autoSubmitTime < "12:00") {
          toast("Auto-submit has to be in the afternoon or evening, before the day locks at midnight", "error");
          return;
        }
        setBusy(true);
        try {
          const res = await apiFetch<{ settings: UpdateSettings }>("/api/admin/update-settings", {
            method: "PUT",
            body: JSON.stringify({ settings: s }),
          });
          setS(res.settings);
          toast("Saved");
        } catch (err) {
          toast(err instanceof Error ? err.message : "Could not save", "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {slot("dailyReminder", "Daily update reminder", "Monday to Saturday, to everyone who hasn't submitted today's update")}
      {slot("weeklyPlanReminder", "Weekly plan reminder", "Monday, to everyone without a plan for the week")}
      {slot("weeklySummaryReminder", "Weekly summary reminder", "Saturday, to everyone who hasn't written how the week went")}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-800">Auto-submit</span>
          <span className="block text-xs text-slate-500">
            Every day&apos;s unsubmitted update (and on Saturday, the week&apos;s) is submitted for them, filled from what the
            board recorded. Always on. The day locks at midnight.
          </span>
        </span>
        <input
          type="time"
          aria-label="Auto-submit time"
          value={s.autoSubmitTime}
          onChange={(e) => setS({ ...s, autoSubmitTime: e.target.value })}
          className={inputClass}
        />
      </div>
      {slot("adminDigest", "Admin digest", "The next morning, to admins: who left their update to the app")}
      <label className="flex items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-slate-200">
        <input
          type="checkbox"
          checked={s.email}
          onChange={(e) => setS({ ...s, email: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
        />
        <span>
          <span className="block text-sm font-semibold text-slate-800">Also send reminders by email</span>
          <span className="block text-xs text-slate-500">
            Reminders always appear in the app and as a browser notification. WhatsApp is not used for these yet.
          </span>
        </span>
      </label>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
