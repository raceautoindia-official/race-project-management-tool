"use client";

import { useState } from "react";
import Modal from "./Modal";
import CalendarSubscribe from "./CalendarSubscribe";

/**
 * "Add to your calendar app" on the Calendar page — the same subscription the
 * profile page offers, where people actually look for it.
 *
 * Once a calendar app has fetched the feed the button stops saying "Add",
 * because by then you have added it and being told to again is confusing.
 */
export default function CalendarConnectButton({
  initialUrl,
  lastFetchedLabel,
  meetingsByEmail,
}: {
  initialUrl: string | null;
  /** Meetings arrive as email invitations, so the feed leaves them out. */
  meetingsByEmail: boolean;
  /** How long ago a calendar app last read the feed, or null if never. */
  lastFetchedLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const connected = Boolean(lastFetchedLabel);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={
          connected
            ? `A calendar app last read your feed ${lastFetchedLabel}. Open to manage it.`
            : undefined
        }
        className={
          connected
            ? "rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm font-semibold text-green-800 hover:bg-green-100"
            : "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        }
      >
        {connected ? (
          <>
            <span aria-hidden="true">✓</span> Calendar connected
          </>
        ) : (
          <>
            <span aria-hidden="true">📅</span> Add to Google, Outlook or Apple
          </>
        )}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add to your calendar app"
        widthClass="max-w-lg"
      >
        <CalendarSubscribe
          initialUrl={initialUrl}
          lastFetchedLabel={lastFetchedLabel}
          meetingsByEmail={meetingsByEmail}
        />
      </Modal>
    </>
  );
}
