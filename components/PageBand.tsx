"use client";

import { usePathname } from "next/navigation";
import { sectionTheme } from "@/lib/section-theme";

/**
 * The band every page opens with, in the colour of the section it belongs
 * to. It reads its own place from the URL, so no page has to be told which
 * colour it is — and nobody can forget to say.
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
    <div
      className={`mb-6 overflow-hidden rounded-2xl bg-gradient-to-br ${theme.band} shadow-lg shadow-slate-900/10`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-6 sm:px-7">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white drop-shadow-sm sm:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 max-w-[65ch] text-sm text-white/80">{subtitle}</p>
          )}
        </div>
        {action}
      </div>

      {figures && figures.length > 0 && (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-white/15 bg-black/10 px-5 py-3 sm:px-7">
          {figures.map((f) => (
            <div key={f.label}>
              <dt className="text-xs font-medium text-white/70">{f.label}</dt>
              <dd className="figure text-lg font-semibold text-white">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
