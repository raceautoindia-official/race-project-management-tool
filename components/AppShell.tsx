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
import type { Role } from "@/lib/types";

interface NavUser {
  id: number;
  name: string;
  role: Role;
}

import { sectionTheme } from "@/lib/section-theme";

const MEMBER_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/projects", label: "Projects", icon: "▢" },
  { href: "/my-tasks", label: "My Tasks", icon: "✓" },
  { href: "/planner", label: "Planner", icon: "🗓" },
  { href: "/team", label: "Team", icon: "◉" },
  { href: "/calendar", label: "Calendar", icon: "▤" },
  { href: "/outstanding", label: "Outstanding", icon: "⚠" },
  { href: "/work-hours", label: "Work hours", icon: "◵" },
  { href: "/meetings", label: "Meetings", icon: "◷" },
  { href: "/reminders", label: "Reminders", icon: "🔔" },
  { href: "/credentials", label: "Credentials", icon: "🔑" },
  { href: "/profile", label: "Profile", icon: "◔" },
];

const ADMIN_LINKS = [
  { href: "/admin", label: "Admin Home", icon: "★" },
  { href: "/admin/activity", label: "Activity Log", icon: "≡" },
  { href: "/admin/documents", label: "Documents", icon: "🗎" },
];

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

  function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
    const active = pathname === href || pathname.startsWith(href + "/");
    const theme = sectionTheme(href);
    return (
      <Link
        href={href}
        onClick={() => setSidebarOpen(false)}
        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
          active
            ? "bg-white/15 text-white shadow-sm"
            : "text-slate-300 hover:bg-white/10 hover:text-white"
        }`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[13px] text-white transition ${theme.band} ${
            active ? "" : "opacity-85 group-hover:opacity-100"
          }`}
        >
          {icon}
        </span>
        {label}
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
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
          {MEMBER_LINKS.map((l) => (
            <NavLink key={l.href} {...l} />
          ))}
          {user.role === "admin" && (
            <>
              <div className="mt-5 flex items-center gap-2 px-4 pb-1">
                <span className="text-xs font-semibold text-slate-400">
                  Administration
                </span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              {ADMIN_LINKS.map((l) => (
                <NavLink key={l.href} {...l} />
              ))}
            </>
          )}
        </nav>
        <div className="flex items-center gap-3 border-t border-slate-800 p-4">
          <Avatar name={user.name} size="md" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-200">
              {user.name}
            </div>
            <div className="text-xs capitalize text-slate-400">{user.role}</div>
          </div>
        </div>
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
