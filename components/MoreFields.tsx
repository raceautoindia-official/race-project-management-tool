"use client";

import { useState } from "react";

/**
 * The fields a form asks for only if you want them.
 *
 * Creating one task used to mean facing sixteen fields, five of them marked
 * required, before anything could be saved. Most of them have sensible
 * defaults and most people never change them. They are still here — one
 * click away, and already open when they hold something.
 */
export default function MoreFields({
  label,
  hint,
  summary,
  defaultOpen = false,
  children,
}: {
  label: string;
  /** What is in here, for someone deciding whether to open it. */
  hint?: string;
  /** What it currently holds, shown while closed. */
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl ring-1 ring-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50"
      >
        <span aria-hidden="true" className="text-xs text-slate-500">
          {open ? "▾" : "▸"}
        </span>
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {!open && (summary || hint) && (
          <span className="ml-auto truncate pl-2 text-xs text-slate-500">
            {summary || hint}
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 px-3 py-3">{children}</div>
      )}
    </div>
  );
}
