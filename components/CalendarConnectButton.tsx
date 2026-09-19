"use client";

import { useState } from "react";
import Modal from "./Modal";
import CalendarSubscribe from "./CalendarSubscribe";

/**
 * "Add to your calendar app" on the Calendar page — the same subscription the
 * profile page offers, where people actually look for it.
 */
export default function CalendarConnectButton({ initialUrl }: { initialUrl: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        📅 Add to Google, Outlook or Apple
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add to your calendar app"
        widthClass="max-w-lg"
      >
        <CalendarSubscribe initialUrl={initialUrl} />
      </Modal>
    </>
  );
}
