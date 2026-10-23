"use client";

import { usePathname } from "next/navigation";
import { sectionTheme } from "@/lib/section-theme";

/**
 * The header every page opens with: a light card (as in the approved
 * preview) carrying the section's colour as a stripe along the top and a
 * soft wash behind the title, so the page still says where you are without
 * a dark slab. It reads its own place from the URL, so no page has to be
 * told which colour it is.
 *
 * `figures` render as coloured tiles — the numbers that matter on the page.
 */
export default function PageBand({
  title,
  subtitle,
  action,
  figures,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  figures?: { label: string; value: React.ReactNode }[];
}) {
  const theme = sectionTheme(usePathname());

  return (
    <div className="mb-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className={`h-1.5 bg-gradient-to-r ${theme.band}`} aria-hidden />
      <div className={`flex flex-wrap items-start justify-between gap-4 bg-gradient-to-br ${theme.wash} to-white px-5 py-5 sm:px-6`}>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.7rem]">{title}</h1>
          {subtitle && <p className="mt-1 max-w-[70ch] text-sm text-slate-600">{subtitle}</p>}
        </div>
        {action}
      </div>

      {figures && figures.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 px-5 py-4 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] sm:px-6">
          {figures.map((f, i) => {
            const tone = TILES[i % TILES.length];
            return (
              <div key={f.label} className={`rounded-xl px-3.5 py-2.5 ring-1 ring-inset ${tone.box}`}>
                <dt className={`text-xs font-medium ${tone.label}`}>{f.label}</dt>
                <dd className="figure mt-0.5 text-xl font-semibold text-slate-900">{f.value}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}

/** One hue per figure, in reading order. */
const TILES = [
  { box: "bg-indigo-50 ring-indigo-100", label: "text-indigo-700" },
  { box: "bg-emerald-50 ring-emerald-100", label: "text-emerald-700" },
  { box: "bg-amber-50 ring-amber-100", label: "text-amber-700" },
  { box: "bg-rose-50 ring-rose-100", label: "text-rose-700" },
  { box: "bg-sky-50 ring-sky-100", label: "text-sky-700" },
  { box: "bg-violet-50 ring-violet-100", label: "text-violet-700" },
];
