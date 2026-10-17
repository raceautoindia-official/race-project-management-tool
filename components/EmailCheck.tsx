"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface Result {
  ok: boolean;
  transport: "smtp" | "ses" | "none";
  message: string;
}

/**
 * "Is email actually working?" on the admin page.
 *
 * Notifications fail quietly on purpose — an email that can't be sent must
 * not break the action behind it — so nothing surfaces a wrong password or
 * an expired key. This asks.
 */
export default function EmailCheck() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"check" | "send" | null>(null);

  async function run(kind: "check" | "send") {
    setBusy(kind);
    setResult(null);
    try {
      setResult(
        await apiFetch<Result>("/api/admin/email-check", {
          method: kind === "send" ? "POST" : "GET",
        })
      );
    } catch (e) {
      setResult({
        ok: false,
        transport: "none",
        message: e instanceof Error ? e.message : "Could not check email",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        Notifications and meeting invitations go out by email. Failures are logged
        rather than shown, so check here after changing any mail setting.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run("check")}
          disabled={busy !== null}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "check" ? "Checking…" : "Check settings"}
        </button>
        <button
          onClick={() => run("send")}
          disabled={busy !== null}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === "send" ? "Sending…" : "Send me a test"}
        </button>
      </div>
      {result && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-xs ${
            result.ok
              ? "border border-green-300 bg-green-50 text-green-900"
              : "border border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {result.ok ? "✓ " : "⚠ "}
          {result.message}
        </p>
      )}
    </div>
  );
}
