"use client";

import {
  SPEC_FIELDS,
  SPEC_KEYS,
  SPEC_TYPES,
  specBodyKey,
  specFieldsFor,
  WORK_TYPE_LABELS,
  type SpecType,
} from "@/lib/workflow";
import type { SpecColumns, WorkType } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

const TYPE_HINTS: Record<SpecType, string> = {
  correction: "Fix or change something that already exists",
  feature: "Build something that doesn't exist yet",
};

/** Copy the spec columns off a task / request (for form state). */
export function pickSpec(source: SpecColumns | null | undefined): SpecColumns {
  const spec: SpecColumns = {};
  for (const k of SPEC_KEYS) spec[k] = source?.[k] ?? "";
  return spec;
}

/** camelCase API body fields for the spec of `type` (other fields cleared). */
export function specPayload(type: SpecType, spec: SpecColumns): Record<string, string | null> {
  const allowed = new Set(SPEC_FIELDS[type].map((f) => f.key));
  const body: Record<string, string | null> = {};
  for (const k of SPEC_KEYS) {
    body[specBodyKey(k)] = allowed.has(k) ? (spec[k] ?? "").trim() || null : null;
  }
  return body;
}

/** The two-way type picker plus that type's required/optional fields. */
export function WorkSpecFields({
  type,
  onTypeChange,
  spec,
  onSpecChange,
  children,
}: {
  type: WorkType;
  onTypeChange: (t: SpecType) => void;
  spec: SpecColumns;
  onSpecChange: (spec: SpecColumns) => void;
  /** Rendered between the type picker and the spec fields (e.g. the title). */
  children?: React.ReactNode;
}) {
  return (
    <>
      <fieldset>
        <legend className="mb-1 block text-sm font-medium text-slate-700">
          Type <span className="text-red-500">*</span>
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SPEC_TYPES.map((t) => {
            const selected = type === t;
            return (
              <label
                key={t}
                className={`cursor-pointer rounded-lg border px-3 py-2 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400 ${
                  selected
                    ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="work-type"
                  value={t}
                  checked={selected}
                  onChange={() => onTypeChange(t)}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold text-slate-800">
                  {WORK_TYPE_LABELS[t]}
                </span>
                <span className="block text-xs text-slate-600">{TYPE_HINTS[t]}</span>
              </label>
            );
          })}
        </div>
        {type === "general" && (
          <p className="mt-1 text-xs text-slate-500">
            This is a general task (created before task types). Pick a type to add its
            specification.
          </p>
        )}
      </fieldset>

      {children}

      {specFieldsFor(type).map((f) => (
        <div key={f.key}>
          <label
            htmlFor={`spec-${f.key}`}
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            {f.label}
            {f.required ? (
              <span className="text-red-500"> *</span>
            ) : (
              <span className="font-normal text-slate-500"> (optional)</span>
            )}
          </label>
          <textarea
            id={`spec-${f.key}`}
            required={f.required}
            rows={f.required ? 3 : 2}
            maxLength={5000}
            value={spec[f.key] ?? ""}
            onChange={(e) => onSpecChange({ ...spec, [f.key]: e.target.value })}
            placeholder={f.hint}
            className={inputClass}
          />
        </div>
      ))}
    </>
  );
}

/** Read-only display of a spec (empty optional fields show a dash). */
export function SpecView({
  item,
  compact = false,
}: {
  item: SpecColumns & { task_type?: WorkType };
  compact?: boolean;
}) {
  const fields = specFieldsFor(item.task_type);
  if (fields.length === 0) return null;
  return (
    <dl className={compact ? "space-y-2" : "space-y-3"}>
      {fields.map((f) => {
        const value = item[f.key];
        return (
          <div key={f.key}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {f.label}
            </dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">
              {value || <span className="text-slate-500">—</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
