"use client";

// App shell for the platform console — the level above every company. It is
// deliberately darker than the company shell so nobody mistakes one for the
// other, and it only opens for the platform owner (super admin).

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { usePreview } from "@/lib/preview/store";
import { Button, Card } from "@/components/preview/ui";

const NAV = [
  { href: "/preview/platform", label: "Overview", icon: "◎", exact: true },
  { href: "/preview/platform/companies", label: "Companies", icon: "▦" },
  { href: "/preview/platform/billing", label: "Plans & billing", icon: "₹" },
  { href: "/preview/platform/settings", label: "Platform settings", icon: "⚙" },
  { href: "/preview/platform/audit", label: "Audit log", icon: "☰" },
];

export default function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = usePreview();
  // Same trick as the company shell: the mobile menu closes itself on navigation.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-indigo-950">★</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">Platform console</div>
          <div className="text-xs text-indigo-300/80">All companies</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label="Platform">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive(n.href, n.exact) ? "bg-indigo-500/25 text-white" : "text-indigo-100/80 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span className="w-4 text-center" aria-hidden>{n.icon}</span>
            <span className="flex-1">{n.label}</span>
          </Link>
        ))}
      </nav>
      <div className="m-3 rounded-lg bg-white/5 px-3 py-2 text-xs text-indigo-200/80">
        You are managing the whole platform. Company data is only opened through audited impersonation.
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <PreviewBanner />
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 bg-gradient-to-b from-indigo-950 to-slate-950 lg:block">{sidebar}</aside>
        {menuOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/60 lg:hidden" onClick={() => setMenuPath(null)}>
            <aside className="h-full w-64 bg-gradient-to-b from-indigo-950 to-slate-950" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
            <button onClick={() => setMenuPath(pathname)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">☰</button>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-950 px-2.5 py-1 text-xs font-semibold text-white">
              <span aria-hidden>★</span> Platform level
            </span>
            <div className="ml-auto">
              <PersonSwitcher />
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {me.isSuperAdmin ? children : <LockedState />}
          </main>
        </div>
      </div>
    </div>
  );
}

// Copied from Shell.tsx so both shells carry the same preview notice.
function PreviewBanner() {
  return (
    <div className="bg-violet-700 px-4 py-1.5 text-center text-xs text-violet-50">
      <strong>Design preview</strong> — sample data only. Changes stay in this browser and are not saved to the server.
      Items marked <span className="rounded bg-white/15 px-1">⚡ Not connected yet</span> need the backend.
    </div>
  );
}

function LockedState() {
  const { switchUser } = usePreview();
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="text-4xl" aria-hidden>🔒</div>
      <h1 className="mt-3 text-lg font-semibold text-slate-900">This area is for the platform owner</h1>
      <p className="mt-2 text-sm text-slate-600">
        The platform console manages every company on the system — plans, billing and security. Company admins and team
        members manage their own workspace instead.
      </p>
      <div className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
        <Button onClick={() => switchUser("u-super")}>Switch to Asha Menon (Super admin)</Button>
        <Link href="/preview" className="text-sm text-indigo-600 hover:underline">Back to my workspace</Link>
      </div>
    </Card>
  );
}

// ── "Viewing as" switcher ──────────────────────────────────────────────────

const PERSONAS: { id: string; hint: string }[] = [
  { id: "u-super", hint: "Platform super admin" },
  { id: "u-sanjay", hint: "Demo Company — company admin" },
  { id: "u-priya", hint: "Demo Company — project owner" },
  { id: "u-arun", hint: "Demo Company — task owner" },
  { id: "u-meera", hint: "Demo Company — team member" },
];

function PersonSwitcher() {
  const { state, me, switchUser } = usePreview();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const everyone = [...state.platformAdmins, ...state.people];
  const choose = (id: string) => {
    switchUser(id);
    setOpen(false);
    const person = everyone.find((p) => p.id === id);
    router.push(person?.isSuperAdmin ? "/preview/platform" : "/preview");
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1 pl-1 pr-2.5 hover:bg-slate-50">
        <Avatar name={me.name} size="sm" />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[10px] uppercase tracking-wide text-slate-400">Viewing as</span>
          <span className="block text-sm font-medium text-slate-800">{me.name}</span>
        </span>
        <span className="text-xs text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{me.name}</p>
            <p className="text-xs text-slate-500">{me.isSuperAdmin ? "Platform super admin" : state.org.companyName}</p>
            <p className="mt-2 rounded-md bg-violet-50 px-2 py-1.5 text-xs text-violet-800">
              Preview only: switch person to see each level. Real users will sign in with their own account.
            </p>
          </div>
          <div className="px-2 py-2">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Switch person</p>
            {PERSONAS.map(({ id, hint }) => {
              const p = everyone.find((x) => x.id === id);
              if (!p) return null;
              return (
                <button
                  key={id}
                  onClick={() => choose(id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 ${id === me.id ? "bg-indigo-50" : ""}`}
                >
                  <Avatar name={p.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{p.name}</span>
                    <span className="block truncate text-xs text-slate-500">{hint}</span>
                  </span>
                  {id === me.id && <span className="text-xs text-indigo-600">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
