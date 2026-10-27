"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";

export interface PickPerson {
  id: number;
  name: string;
  email?: string | null;
  designation?: string | null;
  department?: string | null;
}

/**
 * Choose several people: the chosen ones stay in view as chips, and a search
 * box opens a list grouped by department underneath — in the page flow, so
 * it pushes the rest of the form down instead of covering it.
 *
 * - Type to filter by name, email, job title or department.
 * - ↑ ↓ move, Enter adds or removes, Esc closes, Backspace in an empty box
 *   removes the last chip. Enter never submits the surrounding form.
 * - "+ Add all" on a department adds everyone in it at once.
 * - `fixed` people are shown as chips that can't be removed (the manager,
 *   the requester) so nobody wonders whether they are on it.
 */
export default function PeoplePicker({
  people,
  value,
  onChange,
  fixed = [],
  label,
  myDepartment,
  placeholder = "Search by name, job title or department…",
}: {
  people: PickPerson[];
  value: number[];
  onChange: (ids: number[]) => void;
  /** Already included and not removable here, with the reason shown on the chip. */
  fixed?: { id: number; note: string }[];
  label: string;
  /** Listed first: it is who people pick from most days. */
  myDepartment?: string | null;
  placeholder?: string;
}) {
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const fixedIds = useMemo(() => new Set(fixed.map((f) => f.id)), [fixed]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const chosen = value.filter((id) => !fixedIds.has(id) && byId.has(id));

  // What the list shows: everyone not fixed, matching the search, by department.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: PickPerson) =>
      !q || [p.name, p.email, p.designation, p.department].some((v) => (v ?? "").toLowerCase().includes(q));
    const map = new Map<string, PickPerson[]>();
    for (const p of people) {
      if (fixedIds.has(p.id) || !match(p)) continue;
      const key = p.department || "No department";
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "No department") return 1;
      if (b === "No department") return -1;
      const mine = (n: string) => (myDepartment && n === myDepartment ? 0 : 1);
      return mine(a) - mine(b) || a.localeCompare(b);
    });
  }, [people, query, fixedIds, myDepartment]);
  const flat = groups.flatMap(([, list]) => list);

  // Close when focus or a click leaves the picker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }
  function addAll(list: PickPerson[]) {
    onChange([...new Set([...value, ...list.map((p) => p.id)])]);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      // Never submit the form from here.
      e.preventDefault();
      const p = flat[active];
      if (open && p) toggle(p.id);
      else setOpen(true);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation(); // close the list, not the dialog
        setOpen(false);
      }
    } else if (e.key === "Backspace" && !query && chosen.length) {
      onChange(value.filter((v) => v !== chosen[chosen.length - 1]));
    }
  }

  const activeId = flat[active] ? `${listId}-opt-${flat[active].id}` : undefined;

  return (
    <div ref={box} className="relative">
      <div
        className="flex min-h-[2.75rem] flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500"
        onClick={() => input.current?.focus()}
      >
        {fixed.map((f) => {
          const p = byId.get(f.id);
          if (!p) return null;
          return (
            <span key={`fixed-${f.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 py-0.5 pl-0.5 pr-2.5 text-xs text-indigo-800 ring-1 ring-inset ring-indigo-200" title={f.note}>
              <Avatar name={p.name} size="xs" />
              {p.name}
              <span className="text-indigo-500">· {f.note}</span>
            </span>
          );
        })}
        {chosen.map((id) => {
          const p = byId.get(id)!;
          return (
            <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-1 text-xs text-slate-800 ring-1 ring-inset ring-slate-200">
              <Avatar name={p.name} size="xs" />
              {p.name}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(id);
                }}
                className="rounded-full px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                aria-label={`Remove ${p.name}`}
              >
                ✕
              </button>
            </span>
          );
        })}
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Leaving the picker (Tab, or a click elsewhere) closes the list.
          onBlur={(e) => {
            if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
          }}
          onKeyDown={onKey}
          placeholder={chosen.length || fixed.length ? "Add more people…" : placeholder}
          aria-label={label}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? activeId : undefined}
          aria-autocomplete="list"
          // The box around it shows focus; a second ring inside would be noise.
          className="min-w-[10rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-slate-400 focus:outline-none focus-visible:outline-none"
        />
      </div>

      <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
        <span>
          {chosen.length === 0 ? "Nobody added yet" : `${chosen.length} added`}
          {fixed.length > 0 && ` · plus ${fixed.length === 1 ? "1 already on it" : `${fixed.length} already on it`}`}
        </span>
        {chosen.length > 0 && (
          <button type="button" onClick={() => onChange(value.filter((v) => fixedIds.has(v)))} className="font-medium text-slate-500 hover:text-red-600">
            Clear all
          </button>
        )}
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm"
        >
          {flat.length === 0 ? (
            <p className="px-2 py-3 text-sm text-slate-500">{query ? `Nobody matches “${query}”.` : "No one else to add."}</p>
          ) : (
            groups.map(([dept, list]) => {
              const notYet = list.filter((p) => !value.includes(p.id));
              return (
                <div key={dept} role="group" aria-label={dept}>
                  <div className="sticky top-0 flex items-center justify-between bg-white/95 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <span>
                      {dept} <span className="font-normal normal-case text-slate-400">· {list.length}</span>
                    </span>
                    {notYet.length > 1 && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addAll(notYet)}
                        className="rounded px-1.5 py-0.5 normal-case tracking-normal text-indigo-600 hover:bg-indigo-50"
                      >
                        + Add all ({notYet.length})
                      </button>
                    )}
                  </div>
                  {list.map((p) => {
                    const on = value.includes(p.id);
                    const isActive = flat[active]?.id === p.id;
                    return (
                      <div
                        key={p.id}
                        id={`${listId}-opt-${p.id}`}
                        role="option"
                        aria-selected={on}
                        onMouseDown={(e) => e.preventDefault()} // keep focus in the box
                        onClick={() => toggle(p.id)}
                        onMouseEnter={() => setActive(flat.indexOf(p))}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${isActive ? "bg-indigo-50" : ""}`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"}`}
                          aria-hidden
                        >
                          {on ? "✓" : ""}
                        </span>
                        <Avatar name={p.name} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-800">{p.name}</span>
                          {(p.designation || p.email) && <span className="block truncate text-xs text-slate-500">{p.designation || p.email}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
