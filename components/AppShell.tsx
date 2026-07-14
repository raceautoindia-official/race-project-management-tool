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

const MEMBER_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/projects", label: "Projects", icon: "▢" },
  { href: "/my-tasks", label: "My Tasks", icon: "✓" },
  { href: "/team", label: "Team", icon: "◉" },
  { href: "/calendar", label: "Calendar", icon: "▤" },
  { href: "/outstanding", label: "Outstanding", icon: "⚠" },
  { href: "/meetings", label: "Meetings", icon: "◷" },
  { href: "/reminders", label: "Reminders", icon: "🔔" },
  { href: "/profile", label: "Profile", icon: "◔" },
];

const ADMIN_LINKS = [
  { href: "/admin", label: "Admin Home", icon: "★" },
  { href: "/admin/activity", label: "Activity Log", icon: "≡" },
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
    return (
      <Link
        href={href}
        onClick={() => setSidebarOpen(false)}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
          active
            ? "bg-indigo-600 text-white"
            : "text-slate-300 hover:bg-slate-800 hover:text-white"
        }`}
      >
        <span className="w-4 text-center">{icon}</span>
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
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col bg-slate-900 transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <span className="text-xl font-bold text-white">
            PM<span className="text-indigo-400">App</span>
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-slate-400 hover:text-white md:hidden"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {MEMBER_LINKS.map((l) => (
            <NavLink key={l.href} {...l} />
          ))}
          {user.role === "admin" && (
            <>
              <div className="mt-4 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Administration
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
            <div className="text-xs capitalize text-slate-500">{user.role}</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-xl text-slate-500 md:hidden"
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
