"use client";

import { formatRelative } from "@/lib/format";
import type { ProjectTemplate } from "@/lib/types";

/**
 * Choosing what a new project starts from.
 *
 * A dropdown of names asks you to remember what each template contains. A
 * card can simply say: six tasks, three labels, and here are the first few
 * titles. Picking is then a decision rather than a guess.
 */

/** The titles come back as a JSON array or its string form, depending on MySQL. */
function titlesOf(value: ProjectTemplate["task_titles"]): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function Count({ n, one, many }: { n: number; one: string; many: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="figure font-semibold text-slate-800">{n}</span>
      <span>{n === 1 ? one : many}</span>
    </span>
  );
}

export default function TemplatePicker({
  templates,
  value,
  onChange,
}: {
  templates: ProjectTemplate[];
  /** "" for a blank project. */
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 block text-sm font-medium text-slate-700">
        Start from
      </legend>

      <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        <Option
          selected={value === ""}
          onSelect={() => onChange("")}
          name="Blank project"
          accent="from-slate-500 to-slate-700"
          glyph="＋"
        >
          <p className="text-xs text-slate-600">
            Nothing in it yet. Add tasks as you go.
          </p>
        </Option>

        {templates.map((t) => {
          const titles = titlesOf(t.task_titles);
          return (
            <Option
              key={t.id}
              selected={value === String(t.id)}
              onSelect={() => onChange(String(t.id))}
              name={t.name}
              accent="from-violet-500 to-fuchsia-600"
              glyph="▦"
            >
              {t.description && (
                <p className="line-clamp-2 text-xs text-slate-600">{t.description}</p>
              )}
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                <Count n={Number(t.task_count ?? 0)} one="task" many="tasks" />
                <Count n={Number(t.label_count ?? 0)} one="label" many="labels" />
                <Count
                  n={Number(t.milestone_count ?? 0)}
                  one="milestone"
                  many="milestones"
                />
              </p>
              {titles.length > 0 && (
                <p className="mt-1.5 truncate text-xs text-slate-500">
                  {titles.slice(0, 3).join(" · ")}
                  {titles.length > 3 ? ` · +${titles.length - 3} more` : ""}
                </p>
              )}
              {t.created_by_name && t.created_at && (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Saved by {t.created_by_name} {formatRelative(t.created_at)}
                </p>
              )}
            </Option>
          );
        })}
      </div>
    </fieldset>
  );
}

function Option({
  selected,
  onSelect,
  name,
  accent,
  glyph,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  accent: string;
  glyph: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`relative flex cursor-pointer gap-3 rounded-xl p-3 ring-1 transition ${
        selected
          ? "bg-indigo-50 ring-2 ring-indigo-500"
          : "bg-white ring-slate-200 hover:ring-indigo-300"
      }`}
    >
      <input
        type="radio"
        name="project-template"
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-sm text-white ${accent}`}
      >
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">
          {name}
        </span>
        {children}
      </span>
      {selected && (
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 text-sm font-bold text-indigo-600"
        >
          ✓
        </span>
      )}
    </label>
  );
}
