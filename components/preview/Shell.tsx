"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import { usePreview } from "@/lib/preview/store";
import { projectById, reviewQueue } from "@/lib/preview/engine";
import { Button, timeAgo, usePersonMeta } from "./ui";

// ── Navigation ─────────────────────────────────────────────────────────────

function useNav() {
  const { state, me, terms } = usePreview();
  const reviews = reviewQueue(state, me.id).length;
  return [
    { href: "/preview", label: "My Work", icon: "◎", exact: true },
    { href: "/preview/reviews", label: "Reviews", icon: "✓", badge: reviews },
    { href: "/preview/projects", label: terms.project.many, icon: "▢" },
    { href: "/preview/team", label: "Team", icon: "◉" },
    { href: "/preview/timesheet", label: "Timesheet", icon: "◷" },
    { href: "/preview/calendar", label: "Calendar", icon: "▤" },
    { href: "/preview/reports", label: "Reports", icon: "▥" },
  ];
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const nav = useNav();
  // The mobile menu remembers which page it was opened on, so it closes itself
  // as soon as you navigate somewhere else.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  const setMenuOpen = (open: boolean) => setMenuPath(open ? pathname : null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const { me, state, resetDemo } = usePreview();


  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">PM</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{state.org.companyName}</div>
          <div className="text-xs text-slate-400">Work management</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label="Main">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive(n.href, n.exact) ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span className="w-4 text-center" aria-hidden>{n.icon}</span>
            <span className="flex-1">{n.label}</span>
            {!!n.badge && <span className="rounded-full bg-amber-400 px-1.5 text-xs font-semibold text-slate-900">{n.badge}</span>}
          </Link>
        ))}
        <div className="my-3 border-t border-white/10" />
        <Link
          href="/preview/admin"
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
            isActive("/preview/admin") ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
          }`}
        >
          <span className="w-4 text-center" aria-hidden>⚙</span>
          <span className="flex-1">Admin & settings</span>
          {!me.isAdmin && <span className="text-xs text-slate-500" title="Admins only">🔒</span>}
        </Link>
      </nav>
      <div className="space-y-2 p-3">
        <button
          onClick={() => setGuideOpen(true)}
          className="w-full rounded-lg bg-indigo-500/20 px-3 py-2 text-left text-sm text-indigo-100 hover:bg-indigo-500/30"
        >
          <span className="font-semibold">How it works</span>
          <span className="block text-xs text-indigo-200/80">The 4-step flow in 30 seconds</span>
        </button>
        <Link
          href="/preview/onboarding"
          className="block w-full rounded-lg px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-white/5 hover:text-white"
        >
          ✦ Try new-company onboarding
        </Link>
        <button
          onClick={() => setResetOpen(true)}
          className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200"
        >
          ↺ Reset demo data
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <PreviewBanner />
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 bg-slate-900 lg:block">{sidebar}</aside>
        {/* Mobile sidebar */}
        {menuOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={() => setMenuOpen(false)}>
            <aside className="h-full w-64 bg-slate-900" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenu={() => setMenuOpen(true)} />
          {me.isSuperAdmin && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6 lg:px-8">
              <span>You are inside <strong>{state.org.companyName}</strong>&apos;s workspace as the platform super admin. This visit is audit-logged.</span>
              <Link href="/preview/platform" className="font-medium text-amber-900 underline">← Back to platform console</Link>
            </div>
          )}
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
      <HowItWorks open={guideOpen} onClose={() => setGuideOpen(false)} />
      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset demo data?">
        <p className="text-sm text-slate-600">This puts every project, task and setting back to the original sample data. Anything you changed in this preview will be lost.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => { resetDemo(); setResetOpen(false); }}>Reset</Button>
        </div>
      </Modal>
    </div>
  );
}

function PreviewBanner() {
  return (
    <div className="bg-violet-700 px-4 py-1.5 text-center text-xs text-violet-50">
      <strong>Design preview</strong> — sample data only. Changes stay in this browser and are not saved to the server.
      Items marked <span className="rounded bg-white/15 px-1">⚡ Not connected yet</span> need the backend.
    </div>
  );
}

// ── Top bar ────────────────────────────────────────────────────────────────

function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
      <button onClick={onMenu} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">☰</button>
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-2">
        <NotificationsBell />
        <PersonaSwitcher />
      </div>
    </header>
  );
}

function GlobalSearch() {
  const { state, terms } = usePreview();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const out: { href: string; label: string; kind: string }[] = [];
    for (const p of state.projects)
      if (p.name.toLowerCase().includes(term)) out.push({ href: `/preview/projects/${p.id}`, label: p.name, kind: terms.project.one });
    for (const i of state.items)
      if (i.title.toLowerCase().includes(term)) {
        const taskId = i.parentId ?? i.id;
        out.push({
          href: `/preview/projects/${i.projectId}/tasks/${taskId}${i.parentId ? `?open=${i.id}` : ""}`,
          label: `${i.title} · ${projectById(state, i.projectId)?.name ?? ""}`,
          kind: i.parentId ? terms.subtask.one : terms.task.one,
        });
      }
    for (const p of state.people)
      if (p.name.toLowerCase().includes(term)) out.push({ href: `/preview/team?person=${p.id}`, label: p.name, kind: "Person" });
    return out.slice(0, 8);
  }, [q, state, terms]);

  return (
    <div className="relative w-full max-w-md">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={`Search ${terms.project.many.toLowerCase()}, ${terms.task.many.toLowerCase()}, people…`}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none"
        aria-label="Search"
      />
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((r) => (
            <button
              key={r.href + r.label}
              onMouseDown={() => {
                router.push(r.href);
                setQ("");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span className="w-20 shrink-0 text-xs text-slate-400">{r.kind}</span>
              <span className="truncate text-slate-800">{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, close]);
  return ref;
}

function NotificationsBell() {
  const { state, me, markAllRead, markRead } = usePreview();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  const mine = state.notifications.filter((n) => n.personId === me.id);
  const unread = mine.filter((n) => !n.read).length;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`}>
        🔔
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {mine.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">You&apos;re all caught up.</p>}
            {mine.slice(0, 15).map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  markRead(n.id);
                  setOpen(false);
                  router.push(n.href);
                }}
                className={`flex w-full gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${n.read ? "text-slate-500" : "text-slate-800"}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-indigo-500"}`} />
                <span className="flex-1">
                  {n.text}
                  <span className="block text-xs text-slate-400">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Email & push delivery: <span className="font-medium text-violet-700">⚡ not connected yet</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── "Viewing as" persona switcher ──────────────────────────────────────────

function PersonaSwitcher() {
  const { state, me, switchUser, terms } = usePreview();
  const router = useRouter();
  const meta = usePersonMeta();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));

  const describe = (id: string) => {
    const owns = state.projects.filter((p) => p.ownerId === id).length;
    const tasks = state.items.filter((i) => !i.parentId && i.personId === id).length;
    const subs = state.items.filter((i) => i.parentId && i.personId === id).length;
    const person = state.people.find((p) => p.id === id);
    const parts = [];
    if (person?.isAdmin) parts.push("Admin");
    if (owns) parts.push(`owns ${owns} ${owns === 1 ? terms.project.one : terms.project.many}`.toLowerCase());
    if (tasks) parts.push(`owns ${tasks} ${tasks === 1 ? terms.task.one : terms.task.many}`.toLowerCase());
    if (subs) parts.push(`${subs} ${subs === 1 ? terms.subtask.one : terms.subtask.many} assigned`.toLowerCase());
    return parts.join(" · ") || "No work yet";
  };
  const featured = ["u-priya", "u-arun", "u-meera", "u-sanjay"].filter((id) => state.people.some((p) => p.id === id));
  const roleHint: Record<string, string> = {
    "u-priya": "Try as a project owner",
    "u-arun": "Try as a task owner",
    "u-meera": "Try as a team member",
    "u-sanjay": "Try as an admin",
  };
  const superAdmin = state.platformAdmins[0];
  const m = meta(me.id);

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
        <div className="absolute right-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{me.name}</p>
            <p className="text-xs text-slate-500">{m?.subtitle}</p>
            <p className="mt-2 rounded-md bg-violet-50 px-2 py-1.5 text-xs text-violet-800">
              Preview only: switch person to see the app from each role&apos;s point of view. Real users will log in with their Employee ID.
            </p>
          </div>
          <div className="px-2 py-2">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Quick switch</p>
            {superAdmin && (
              <button
                onClick={() => {
                  switchUser(superAdmin.id);
                  setOpen(false);
                  router.push("/preview/platform");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50"
              >
                <Avatar name={superAdmin.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800">{superAdmin.name} <span className="font-normal text-slate-400">— Platform super admin</span></span>
                  <span className="block truncate text-xs text-slate-500">Manages every company on the platform</span>
                </span>
              </button>
            )}
            {featured.map((id) => {
              const p = state.people.find((x) => x.id === id)!;
              return (
                <button
                  key={id}
                  onClick={() => {
                    switchUser(id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 ${id === me.id ? "bg-indigo-50" : ""}`}
                >
                  <Avatar name={p.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800">{p.name} <span className="font-normal text-slate-400">— {roleHint[id]}</span></span>
                    <span className="block truncate text-xs text-slate-500">{describe(id)}</span>
                  </span>
                </button>
              );
            })}
            <label className="mt-2 block px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Anyone else
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    switchUser(e.target.value);
                    setOpen(false);
                  }
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-800"
              >
                <option value="">Choose a person…</option>
                {state.people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {meta(p.id)?.subtitle}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ── How it works ───────────────────────────────────────────────────────────

export function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { terms } = usePreview();
  const P = terms.project.one, T = terms.task.one, S = terms.subtask.one;
  const steps = [
    { n: 1, title: `A ${P.toLowerCase()} has one owner`, body: `The ${P.toLowerCase()} owner splits the work into ${terms.task.many.toLowerCase()} and gives each ${T.toLowerCase()} an owner.` },
    { n: 2, title: `${terms.task.many} are broken into ${terms.subtask.many.toLowerCase()}`, body: `The ${T.toLowerCase()} owner creates ${terms.subtask.many.toLowerCase()} and assigns each one to a person. Weights are split evenly, and owners can adjust them.` },
    { n: 3, title: "Finished work is reviewed", body: `When someone finishes a ${S.toLowerCase()}, it goes to the ${T.toLowerCase()} owner for review. When every ${S.toLowerCase()} is approved, the ${T.toLowerCase()} goes to the ${P.toLowerCase()} owner.` },
    { n: 4, title: "Progress only counts approved work", body: `Approving a ${S.toLowerCase()} moves the ${T.toLowerCase()} bar. Approving a ${T.toLowerCase()} moves the ${P.toLowerCase()} bar. Work waiting for review shows as a striped amber bar.` },
  ];
  return (
    <Modal open={open} onClose={onClose} title="How it works" widthClass="max-w-2xl">
      <div className="mb-4 rounded-lg bg-slate-50 p-3 font-mono text-sm text-slate-700">
        {P} <span className="text-slate-400">(owner)</span>
        <br />└─ {T} <span className="text-slate-400">(owner)</span>
        <br />&nbsp;&nbsp;&nbsp;└─ {S} <span className="text-slate-400">(assignee)</span>
      </div>
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">{s.n}</span>
            <div>
              <p className="font-medium text-slate-900">{s.title}</p>
              <p className="text-sm text-slate-600">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex justify-end">
        <Button onClick={onClose}>Got it</Button>
      </div>
    </Modal>
  );
}

