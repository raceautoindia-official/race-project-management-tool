"use client";

import { useEffect, useState } from "react";

/**
 * A section card (the look of Cards.tsx SectionCard) that folds away to its
 * title, and remembers on this device whether it was left open or closed —
 * for the parts of a long page someone looks at now and then.
 */
export default function CollapsibleCard({
  id,
  title,
  action,
  children,
}: {
  /** Names the remembered choice; keep it stable. */
  id: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  // Read the saved choice after the first paint, so server and browser agree.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(`pm.fold.${id}`) === "closed") setOpen(false);
    } catch {
      // No storage (private window): it just starts open.
    }
  }, [id]);

  function toggle() {
    setOpen((was) => {
      try {
        localStorage.setItem(`pm.fold.${id}`, was ? "closed" : "open");
      } catch {
        // Fine: the choice lasts until the page is left.
      }
      return !was;
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-3 bg-slate-50 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="flex items-center gap-2 text-left hover:text-indigo-700"
            title={open ? "Fold this section away" : "Show this section"}
          >
            <span aria-hidden className={`text-xs text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>
              ▶
            </span>
            {title}
          </button>
        </h2>
        {open && action}
      </div>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}
