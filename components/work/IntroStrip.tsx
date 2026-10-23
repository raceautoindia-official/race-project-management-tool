"use client";

import { useSyncExternalStore } from "react";

/**
 * "How work flows here" — four steps for newcomers on My Work. Hiding it is
 * remembered in this browser. Until the browser has been asked, it stays
 * hidden, so people who dismissed it never see it flash on load.
 */

const KEY = "pm-work-intro-dismissed";
const EVENT = "pm:work-intro";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "1";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const STEPS = [
  { icon: "👤", text: "Every project and task has one owner" },
  { icon: "🧩", text: "Task owners split tasks into subtasks for people to do" },
  { icon: "✅", text: "Finished work goes to its owner for review" },
  { icon: "📈", text: "Only approved work moves the progress bars" },
];

export default function IntroStrip() {
  const show = useSyncExternalStore(subscribe, read, () => false);
  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // Storage blocked: it simply comes back next time.
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <section aria-labelledby="work-intro-title" className="mb-6 rounded-2xl bg-gradient-to-r from-indigo-50 to-white p-4 ring-1 ring-indigo-200">
      <div className="flex items-start justify-between gap-3">
        <h2 id="work-intro-title" className="text-sm font-semibold text-indigo-900">
          How work flows here
        </h2>
        <button type="button" onClick={dismiss} className="shrink-0 text-xs font-medium text-indigo-700 hover:underline">
          Got it, hide this
        </button>
      </div>
      <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.text} className="flex items-start gap-2 text-sm text-slate-700">
            <span className="text-lg leading-none" aria-hidden>
              {s.icon}
            </span>
            <span>
              <span className="font-semibold text-indigo-700">{i + 1}.</span> {s.text}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
