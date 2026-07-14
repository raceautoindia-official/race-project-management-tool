"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

export default function MarkAllReadButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await apiFetch("/api/notifications", { method: "PATCH" });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {busy ? "…" : "Mark all read"}
    </button>
  );
}
