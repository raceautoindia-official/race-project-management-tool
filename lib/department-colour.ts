/**
 * A colour per department, derived from its name.
 *
 * The list of departments belongs to the Attendance app, so nobody here gets
 * to choose a palette for it. Deriving the colour from the name means the
 * same department looks the same on every screen, and a department added
 * next year already has a colour.
 *
 * Deliberately not a client module: both server and client components colour
 * these, and a "use client" helper cannot be called from a server one.
 */

export interface DepartmentTone {
  /** Badge background and text. */
  chip: string;
  /** A solid fill, for bars. */
  bar: string;
}

const TONES: DepartmentTone[] = [
  { chip: "bg-sky-100 text-sky-800", bar: "bg-sky-500" },
  { chip: "bg-emerald-100 text-emerald-800", bar: "bg-emerald-500" },
  { chip: "bg-violet-100 text-violet-800", bar: "bg-violet-500" },
  { chip: "bg-amber-100 text-amber-900", bar: "bg-amber-500" },
  { chip: "bg-rose-100 text-rose-800", bar: "bg-rose-500" },
  { chip: "bg-teal-100 text-teal-800", bar: "bg-teal-500" },
  { chip: "bg-indigo-100 text-indigo-800", bar: "bg-indigo-500" },
  { chip: "bg-fuchsia-100 text-fuchsia-800", bar: "bg-fuchsia-500" },
];

export function departmentTone(name: string): DepartmentTone {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  }
  return TONES[hash % TONES.length];
}
