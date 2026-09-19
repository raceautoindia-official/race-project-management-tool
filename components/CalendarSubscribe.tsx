"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  feedUrlProblem,
  googleSubscribeUrl,
  outlookSubscribeUrl,
  webcalUrl,
} from "@/lib/calendar-links";
import { useToast } from "./ToastProvider";

const serviceClass =
  "flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50";

interface CheckResult {
  ok: boolean;
  message: string;
  events?: number;
}

/**
 * The private calendar feed: subscribe once in Google, Outlook or Apple
 * Calendar and your meetings, task due dates and reminders keep themselves up
 * to date. The link is the credential, so it can be reset.
 */
export default function CalendarSubscribe({
  initialUrl,
  lastFetchedLabel = null,
}: {
  initialUrl: string | null;
  /**
   * How long ago a calendar app last read the feed, or null if none has.
   * It is the only proof a subscription exists — Google, Outlook and Apple
   * keep the subscription on their side and never tell us about it.
   */
  lastFetchedLabel?: string | null;
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);

  // Google and Microsoft fetch the feed from their own servers. An address
  // only this machine can resolve will never work for them, so say so before
  // the person spends ten minutes wondering why nothing appears.
  const addressProblem = url ? feedUrlProblem(url) : null;

  async function load(rotate: boolean) {
    if (rotate && !confirm("Reset the link? Calendars using the old link will stop updating.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ url: string }>("/api/calendar/token", {
        method: "POST",
        body: JSON.stringify({ rotate }),
      });
      setUrl(res.url);
      setCheck(null);
      toast(rotate ? "New link created" : "Link ready");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create the link", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await apiFetch<CheckResult>("/api/calendar/check"));
    } catch (e) {
      setCheck({
        ok: false,
        message: e instanceof Error ? e.message : "Could not check the link",
      });
    } finally {
      setChecking(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast("Copy failed — select the link and copy it", "error");
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        Subscribe once and your meetings, task due dates and reminders appear in your
        calendar and stay up to date.
      </p>

      {url ? (
        <>
          {/* Whether it is actually working, in the only terms we can know:
              a calendar app has come and read the feed. A real fetch beats the
              address check below it — it is evidence rather than a guess. */}
          {lastFetchedLabel ? (
            <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-900">
              <strong className="font-semibold">Connected.</strong> A calendar app read
              this {lastFetchedLabel}. Your meetings and due dates are going through.
            </p>
          ) : (
            !addressProblem && (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                No calendar app has read this link yet. If you have just added it, Google
                can take a few hours to check the first time — this line will say so once
                it does.
              </p>
            )
          )}

          {/* Once they have checked, the result below says it better. */}
          {addressProblem && !check && (
            <p
              role="alert"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            >
              <strong className="font-semibold">This link won’t work yet.</strong>{" "}
              {addressProblem}
            </p>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <a
              href={googleSubscribeUrl(url)}
              target="_blank"
              rel="noopener noreferrer"
              className={serviceClass}
            >
              <span aria-hidden="true">🗓️</span> Google Calendar
            </a>
            <a
              href={outlookSubscribeUrl(url)}
              target="_blank"
              rel="noopener noreferrer"
              className={serviceClass}
            >
              <span aria-hidden="true">📘</span> Outlook
            </a>
            <a href={webcalUrl(url)} className={serviceClass}>
              <span aria-hidden="true">🍎</span> Apple Calendar
            </a>
          </div>
          <p className="text-xs text-slate-500">
            Each one opens its own “add calendar” screen with the link filled in — confirm
            there and it’s added. The Outlook button opens the work/school site; on a
            personal Outlook.com account,{" "}
            <a
              href={outlookSubscribeUrl(url, "PMApp", { personal: true })}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-indigo-600 hover:underline"
            >
              use this one instead
            </a>
            .
          </p>

          {/* The link is long, so it gets the full width and the buttons sit
              under it rather than squeezing it to a dozen characters. */}
          <div className="space-y-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Your private calendar link"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={copy}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Copy
              </button>
              <button
                onClick={runCheck}
                disabled={checking}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {checking ? "Checking…" : "Check it works"}
              </button>
            </div>
          </div>

          {check && (
            <p
              role="status"
              className={`rounded-lg px-3 py-2 text-xs ${
                check.ok
                  ? "border border-green-300 bg-green-50 text-green-900"
                  : "border border-amber-300 bg-amber-50 text-amber-900"
              }`}
            >
              {check.ok ? "✓ " : "⚠ "}
              {check.message}
            </p>
          )}

          <details className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
            <summary className="cursor-pointer font-medium">How to add it</summary>
            <ul className="mt-2 space-y-1 text-xs">
              <li>
                <strong>Google Calendar:</strong> Other calendars → + → From URL → paste → Add
                calendar.
              </li>
              <li>
                <strong>Outlook:</strong> Add calendar → Subscribe from web → paste → Import.
              </li>
              <li>
                <strong>Apple Calendar:</strong> File → New Calendar Subscription → paste → OK.
              </li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Calendars refresh on their own schedule — usually every few hours, and Google
              can take up to a day the first time. Nothing you can change at either end
              makes it faster.
            </p>
          </details>
          <button
            onClick={() => load(true)}
            disabled={busy}
            className="inline-block py-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
          >
            Reset link
          </button>
        </>
      ) : (
        <button
          onClick={() => load(false)}
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create my calendar link"}
        </button>
      )}
    </div>
  );
}
