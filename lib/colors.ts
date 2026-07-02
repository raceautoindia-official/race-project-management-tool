// Static color maps. Tailwind only keeps classes it can see as literal strings,
// so every possible class is written out here rather than built dynamically.

export const LABEL_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;

export type LabelColor = (typeof LABEL_COLORS)[number];

export const LABEL_CHIP_CLASSES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  red: "bg-red-100 text-red-700 ring-red-200",
  orange: "bg-orange-100 text-orange-700 ring-orange-200",
  amber: "bg-amber-100 text-amber-800 ring-amber-200",
  green: "bg-green-100 text-green-700 ring-green-200",
  teal: "bg-teal-100 text-teal-700 ring-teal-200",
  blue: "bg-blue-100 text-blue-700 ring-blue-200",
  indigo: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  purple: "bg-purple-100 text-purple-700 ring-purple-200",
  pink: "bg-pink-100 text-pink-700 ring-pink-200",
};

export const LABEL_SWATCH_CLASSES: Record<string, string> = {
  slate: "bg-slate-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
};

export function labelChipClass(color: string): string {
  return LABEL_CHIP_CLASSES[color] ?? LABEL_CHIP_CLASSES.slate;
}

export function labelSwatchClass(color: string): string {
  return LABEL_SWATCH_CLASSES[color] ?? LABEL_SWATCH_CLASSES.slate;
}

// Deterministic avatar background based on a name/id.
const AVATAR_CLASSES = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-green-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-pink-500",
];

export function avatarColorClass(seed: string | number): string {
  const str = String(seed);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return AVATAR_CLASSES[hash % AVATAR_CLASSES.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
