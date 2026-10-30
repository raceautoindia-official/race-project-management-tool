"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";

/**
 * Remind someone (or everyone who still owes it) about a work update now:
 * an in-app notification with a browser push, and an email if switched on.
 * People who have already done it are skipped by the server.
 */
export default function RemindButton({
  kind,
  date,
  userIds,
  label,
  className = "",
}: {
  kind: "day" | "week_plan" | "week_summary";
  date: string;
  /** Leave out to remind everyone you can who still owes it. */
  userIds?: number[];
  label: string;
  className?: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await apiFetch<{ sent: number; skipped: number }>("/api/work-updates/remind", {
            method: "POST",
            body: JSON.stringify({ kind, date, userIds }),
          });
          toast(
            res.sent === 0
              ? "Nobody to remind — it's already done"
              : `Reminder sent to ${res.sent} ${res.sent === 1 ? "person" : "people"}`
          );
          router.refresh();
        } catch (e) {
          toast(e instanceof Error ? e.message : "Could not send the reminder", "error");
        } finally {
          setBusy(false);
        }
      }}
      className={`rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50 ${className}`}
    >
      {busy ? "Sending…" : `🔔 ${label}`}
    </button>
  );
}
