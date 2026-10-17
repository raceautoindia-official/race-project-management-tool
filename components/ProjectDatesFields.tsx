"use client";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/** The message to show when a range runs backwards, or null when it is fine. */
export function dateOrderError(start: string, due: string): string | null {
  return start && due && due < start ? "The due date can't be before the start date." : null;
}

/**
 * A project's start and due date, side by side. Both are optional; the due
 * date can't be earlier than the start (the server checks this too).
 */
export default function ProjectDatesFields({
  idPrefix,
  start,
  due,
  onStart,
  onDue,
  disabled = false,
}: {
  idPrefix: string;
  start: string;
  due: string;
  onStart: (v: string) => void;
  onDue: (v: string) => void;
  disabled?: boolean;
}) {
  const error = dateOrderError(start, due);
  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-start`} className="mb-1 block text-sm font-medium text-slate-700">
            Start date
          </label>
          <input
            id={`${idPrefix}-start`}
            type="date"
            value={start}
            disabled={disabled}
            onChange={(e) => onStart(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-due`} className="mb-1 block text-sm font-medium text-slate-700">
            Due date
          </label>
          <input
            id={`${idPrefix}-due`}
            type="date"
            value={due}
            min={start || undefined}
            disabled={disabled}
            onChange={(e) => onDue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${idPrefix}-dates-hint`}
            className={`${inputClass} ${error ? "border-red-400" : ""}`}
          />
        </div>
      </div>
      <p
        id={`${idPrefix}-dates-hint`}
        role={error ? "alert" : undefined}
        className={`mt-1 text-xs ${error ? "text-red-600" : "text-slate-600"}`}
      >
        {error ?? "Used to show whether the project is on schedule."}
      </p>
    </div>
  );
}
