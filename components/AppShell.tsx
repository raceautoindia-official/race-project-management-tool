"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import NotificationsBell from "./NotificationsBell";
import GlobalSearch from "./GlobalSearch";
import Avatar from "./Avatar";
import { RoleBadge } from "./Badge";
import { useToast } from "./ToastProvider";
import { useReviewCount } from "./work/review-count";
import type { Role } from "@/lib/types";

interface NavUser {
  id: number;
  name: string;
  role: Role;
}

import { sectionTheme } from "@/lib/section-theme";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

/**
 * The rail, in the groups agreed for the redesign (docs/IMPLEMENTATION_MAPPING.md §3).
 * My Tasks and Outstanding are not listed any more: they live inside My Work
 * and Reviews, and their old addresses redirect there.
 */
const MEMBER_NAV: { label: string; links: NavItem[] }[] = [
  {
    label: "Work",
    links: [
      { href: "/dashboard", label: "My Work", icon: "▦" },
      { href: "/reviews", label: "Reviews", icon: "✓" },
      { href: "/projects", label: "Projects", icon: "▢" },
      { href: "/planner", label: "Work Updates", icon: "🗓" },
      { href: "/calendar", label: "Calendar", icon: "▤" },
    ],
  },
  {
    label: "People",
    links: [
      { href: "/team", label: "Team", icon: "◉" },
      { href: "/work-hours", label: "Work hours", icon: "◵" },
    ],
  },
  {
    label: "Tools",
    links: [
      { href: "/meetings", label: "Meetings", icon: "◷" },
      { href: "/reminders", label: "Reminders", icon: "🔔" },
      { href: "/credentials", label: "Credentials", icon: "🔑" },
    ],
  },
  {
    label: "Insight",
    links: [{ href: "/reports", label: "Reports", icon: "▥" }],
  },
];

/**
 * An admin runs the organisation rather than working a to-do list, so their
 * rail starts at the Control centre and leaves out My Work, Reviews and the
 * personal Work Updates (their addresses still work). Everything waiting on a
 * decision across the organisation is Approvals; everyone's daily and weekly
 * updates are read in Team (a person's profile, and the Daily updates grid).
 */
const ADMIN_NAV: { label: string; links: NavItem[] }[] = [
  {
    label: "Overview",
    links: [
      { href: "/admin", label: "Control centre", icon: "★" },
      { href: "/reports", label: "Reports", icon: "▥" },
    ],
  },
  {
    label: "Organisation",
    links: [
      { href: "/projects", label: "Projects", icon: "▢" },
      { href: "/reviews", label: "Approvals", icon: "✓" },
      { href: "/team", label: "Team", icon: "◉" },
      { href: "/work-hours", label: "Work hours", icon: "◵" },
    ],
  },
  {
    label: "Records & setup",
    links: [
      { href: "/admin/people", label: "People & levels", icon: "☰" },
      { href: "/admin/updates", label: "Update reminders", icon: "🔔" },
      { href: "/admin/activity", label: "Activity Log", icon: "≡" },
      { href: "/admin/documents", label: "Documents", icon: "🗎" },
      { href: "/credentials", label: "Credentials", icon: "🔑" },
    ],
  },
  {
    label: "Tools",
    links: [
      { href: "/meetings", label: "Meetings", icon: "◷" },
      { href: "/calendar", label: "Calendar", icon: "▤" },
      { href: "/reminders", label: "Reminders", icon: "🔔" },
    ],
  },
];

const ALL_HREFS = [...MEMBER_NAV, ...ADMIN_NAV].flatMap((g) => g.links.map((l) => l.href)).concat("/profile");

export default function AppShell({
  user,
  children,
}: {
  user: NavUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const reviewCount = useReviewCount();

  async function logout() {
    setBusy(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore — clear client state regardless
    }
    toast("Signed out");
    router.push("/login");
    router.refresh();
  }

  const matches = (href: string) => pathname === href || pathname.startsWith(href + "/");
  // The most specific item wins, so /admin/people lights People & levels, not Admin Home.
  const isActive = (href: string) =>
    matches(href) && !ALL_HREFS.some((h) => h.length > href.length && h.startsWith(href) && matches(h));
  const profileActive = isActive("/profile");

  function NavLink({ href, label, icon, badge }: NavItem & { badge?: number }) {
    const active = isActive(href);
    const theme = sectionTheme(href);
    return (
      <Link
        href={href}
        onClick={() => setSidebarOpen(false)}
        aria-current={active ? "page" : undefined}
        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
          active
            ? "bg-white/15 text-white shadow-sm"
            : "text-slate-300 hover:bg-white/10 hover:text-white"
        }`}
      >
        <span
          aria-hidden
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[13px] text-white transition ${theme.band} ${
            active ? "" : "opacity-85 group-hover:opacity-100"
          }`}
        >
          {icon}
        </span>
        <span className="flex-1">{label}</span>
        {badge ? (
          <span className="figure min-w-5 rounded-full bg-amber-400 px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-slate-900">
            {badge > 99 ? "99+" : badge}
            <span className="sr-only"> waiting for you</span>
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <div className="flex min-h-screen">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-slate-900 bg-gradient-to-b from-slate-900 via-slate-900 to-indigo-950 transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <span className="text-xl font-bold tracking-tight text-white">
            PM<span className="text-indigo-400">App</span>
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="-mr-1 flex h-10 w-10 items-center justify-center rounded text-slate-300 hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-4" aria-label="Main">
          {(user.role === "admin" ? ADMIN_NAV : MEMBER_NAV).map((g, i) => (
            <div key={g.label} role="group" aria-label={g.label} className={i === 0 ? "" : "mt-4"}>
              <div className="flex items-center gap-2 px-4 pb-1">
                <span className="text-xs font-semibold text-slate-400">{g.label}</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <div className="flex flex-col gap-1">
                {g.links.map((l) => (
                  <NavLink key={l.href} {...l} badge={l.href === "/reviews" ? reviewCount : undefined} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        {/* The user area is the way to Profile. */}
        <Link
          href="/profile"
          onClick={() => setSidebarOpen(false)}
          aria-current={profileActive ? "page" : undefined}
          className={`flex items-center gap-3 border-t border-slate-800 p-4 transition hover:bg-white/5 ${
            profileActive ? "bg-white/10" : ""
          }`}
        >
          <Avatar name={user.name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-200">
              {user.name}
            </div>
            <div className="text-xs text-slate-400">
              <span className="capitalize">{user.role}</span> · Profile
            </div>
          </div>
          <span className="text-slate-500" aria-hidden>
            ›
          </span>
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="-ml-2 flex h-10 w-10 items-center justify-center rounded text-xl text-slate-600 hover:bg-slate-100 md:hidden"
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="flex-1">
            <GlobalSearch />
          </div>
          <RoleBadge role={user.role} />
          <NotificationsBell />
          <button
            onClick={logout}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Log out
          </button>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
