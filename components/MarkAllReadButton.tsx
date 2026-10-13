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
      className="on-band rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
    >
      {busy ? "…" : "Mark all read"}
    </button>
  );
}
