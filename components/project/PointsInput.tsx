"use client";

import { useState } from "react";

/**
 * The points stored in a spec field — one per line, blanks dropped, and any
 * list marker someone typed or pasted ("- ", "1. ") removed, since the box in
 * front of the point is the marker now.
 */
export function pointsOf(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•‣▪]|\d+[.)])\s+/, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * A spec field written as points rather than a paragraph.
 *
 * Each point becomes one checkbox on the task's checklist, so it is entered as
 * one — a box you tick later should not have to be picked out of prose by
 * whoever reads it. Stored exactly as before: the points joined by newlines.
 */
export default function PointsInput({
  id,
  label,
  required,
  hint,
  help,
  addLabel = "+ Add point",
  value,
  onChange,
}: {
  id: string;
  label: string;
  required: boolean;
  /** What this field is for, shown under the label. */
  hint: string;
  /** Replaces the sentence under the label, where "a checkbox" is wrong. */
  help?: React.ReactNode;
  addLabel?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // The rows are the editing state; `value` is what they add up to. Seeding
  // once is enough: both forms that use this mount fresh each time they open
  // (their own spec state is a useState initializer too), so there is no
  // in-place reset to follow.
  const [rows, setRows] = useState<string[]>(() => {
    const points = pointsOf(value);
    return points.length ? points : [""];
  });

  function commit(next: string[]) {
    setRows(next);
    onChange(
      next
        .map((r) => r.trim())
        .filter(Boolean)
        .join("\n")
    );
  }

  const filled = rows.filter((r) => r.trim()).length;

  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required ? (
          <span className="text-red-500"> *</span>
        ) : (
          <span className="font-normal text-slate-500"> (optional)</span>
        )}
      </legend>
      {/* Every field says what it wants, so it is never a guess. */}
      <p className="mb-2 text-xs text-slate-500">
        {help ?? (
          <>
            Add one point per box — <strong>each becomes a checkbox</strong> on the
            task, ticked off as the work is done. {hint}.
          </>
        )}
      </p>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <span aria-hidden="true" className="text-base leading-none text-slate-400">
              ☐
            </span>
            <input
              id={i === 0 ? id : undefined}
              value={row}
              required={required && filled === 0 && i === 0}
              maxLength={255}
              aria-label={`${label} — point ${i + 1}`}
              placeholder={i === 0 ? hint : "One more point…"}
              onChange={(e) => {
                const next = [...rows];
                next[i] = e.target.value;
                commit(next);
              }}
              onKeyDown={(e) => {
                // Enter adds the next point rather than submitting the form
                // halfway through writing the list.
                if (e.key === "Enter") {
                  e.preventDefault();
                  const next = [...rows];
                  next.splice(i + 1, 0, "");
                  commit(next);
                }
              }}
              onPaste={(e) => {
                // A list pasted from a document becomes one point per line,
                // which a single-line box would otherwise run together.
                const text = e.clipboardData.getData("text");
                const pasted = pointsOf(text);
                if (pasted.length < 2) return;
                e.preventDefault();
                const next = [...rows];
                next.splice(i, 1, ...pasted);
                commit(next);
              }}
              className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {(rows.length > 1 || row.trim()) && (
              <button
                type="button"
                onClick={() => {
                  const next = rows.filter((_, x) => x !== i);
                  commit(next.length ? next : [""]);
                }}
                aria-label={`Remove point ${i + 1}`}
                className="rounded px-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => commit([...rows, ""])}
        className="mt-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {addLabel}
      </button>
    </fieldset>
  );
}
