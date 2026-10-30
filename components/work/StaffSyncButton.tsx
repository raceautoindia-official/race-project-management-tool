"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";

/**
 * Check everyone against Attendance now, rather than wait for the next
 * scheduled sweep. With `force`, applies a large change the sweep held back,
 * after the admin has confirmed it.
 */
export default function StaffSyncButton({ force = false, label }: { force?: boolean; label: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (force && !window.confirm("Retire everyone Attendance no longer lists as working? Their work stays; they can be restored by reactivating them in Attendance.")) {
          return;
        }
        setBusy(true);
        try {
          const res = await apiFetch<{ retired: unknown[]; returned: unknown[]; held: string | null }>(
            "/api/admin/staff-sync",
            { method: "POST", body: JSON.stringify({ force }) }
          );
          if (res.held) toast(res.held, "error");
          else if (!res.retired.length && !res.returned.length) toast("Everyone matches Attendance");
          else
            toast(
              [
                res.retired.length && `${res.retired.length} retired`,
                res.returned.length && `${res.returned.length} back at work`,
              ]
                .filter(Boolean)
                .join(", ")
            );
          router.refresh();
        } catch (e) {
          toast(e instanceof Error ? e.message : "Could not check Attendance", "error");
        } finally {
          setBusy(false);
        }
      }}
      className={
        force
          ? "rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          : "rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      }
    >
      {busy ? "Checking…" : label}
    </button>
  );
}
