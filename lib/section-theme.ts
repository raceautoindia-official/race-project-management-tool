/**
 * A colour per section of the app.
 *
 * Twelve places to be, and no way to tell them apart at a glance is a tool
 * you navigate by reading. Each section owns a hue: its icon in the rail,
 * the band at the top of its page, and the tint on anything that belongs to
 * it. After a week nobody reads the labels — amber is the planner, pink is
 * the team.
 */

export interface SectionTheme {
  /** The two stops of the page band, as Tailwind gradient classes. */
  band: string;
  /** The icon in the rail, and the rule under the band. */
  ink: string;
  /** A faint wash for surfaces that belong to this section. */
  tint: string;
  /** The ring on those surfaces. */
  edge: string;
}

const THEMES: Record<string, SectionTheme> = {
  "/dashboard": {
    band: "from-indigo-600 via-indigo-700 to-violet-800",
    ink: "text-indigo-300",
    tint: "bg-indigo-50",
    edge: "ring-indigo-200",
  },
  "/projects": {
    band: "from-violet-600 via-violet-700 to-fuchsia-800",
    ink: "text-violet-300",
    tint: "bg-violet-50",
    edge: "ring-violet-200",
  },
  "/my-tasks": {
    band: "from-emerald-600 via-emerald-700 to-teal-800",
    ink: "text-emerald-300",
    tint: "bg-emerald-50",
    edge: "ring-emerald-200",
  },
  "/planner": {
    band: "from-amber-500 via-orange-600 to-orange-700",
    ink: "text-amber-300",
    tint: "bg-amber-50",
    edge: "ring-amber-200",
  },
  "/team": {
    band: "from-pink-600 via-rose-600 to-rose-800",
    ink: "text-pink-300",
    tint: "bg-pink-50",
    edge: "ring-pink-200",
  },
  "/calendar": {
    band: "from-cyan-600 via-sky-700 to-blue-800",
    ink: "text-cyan-300",
    tint: "bg-cyan-50",
    edge: "ring-cyan-200",
  },
  "/outstanding": {
    band: "from-rose-600 via-red-600 to-red-800",
    ink: "text-rose-300",
    tint: "bg-rose-50",
    edge: "ring-rose-200",
  },
  "/work-hours": {
    band: "from-teal-600 via-teal-700 to-emerald-800",
    ink: "text-teal-300",
    tint: "bg-teal-50",
    edge: "ring-teal-200",
  },
  "/meetings": {
    band: "from-sky-600 via-blue-700 to-indigo-800",
    ink: "text-sky-300",
    tint: "bg-sky-50",
    edge: "ring-sky-200",
  },
  "/reminders": {
    band: "from-orange-500 via-rose-600 to-rose-700",
    ink: "text-orange-300",
    tint: "bg-orange-50",
    edge: "ring-orange-200",
  },
  "/credentials": {
    band: "from-yellow-500 via-amber-600 to-amber-700",
    ink: "text-yellow-300",
    tint: "bg-yellow-50",
    edge: "ring-yellow-200",
  },
  "/profile": {
    band: "from-slate-700 via-slate-800 to-indigo-900",
    ink: "text-slate-300",
    tint: "bg-slate-50",
    edge: "ring-slate-200",
  },
  "/notifications": {
    band: "from-indigo-600 via-violet-700 to-violet-800",
    ink: "text-indigo-300",
    tint: "bg-indigo-50",
    edge: "ring-indigo-200",
  },
  "/admin": {
    band: "from-slate-800 via-indigo-900 to-violet-900",
    ink: "text-violet-300",
    tint: "bg-violet-50",
    edge: "ring-violet-200",
  },
};

const FALLBACK: SectionTheme = THEMES["/dashboard"];

/** The theme for a path, matching the longest section that contains it. */
export function sectionTheme(pathname: string | null | undefined): SectionTheme {
  if (!pathname) return FALLBACK;
  let best: SectionTheme | null = null;
  let bestLength = 0;
  for (const [href, theme] of Object.entries(THEMES)) {
    if (
      (pathname === href || pathname.startsWith(href + "/")) &&
      href.length > bestLength
    ) {
      best = theme;
      bestLength = href.length;
    }
  }
  return best ?? FALLBACK;
}
