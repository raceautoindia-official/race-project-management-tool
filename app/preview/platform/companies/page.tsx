"use client";

// Every company (tenant) on the platform. Click a row for details and actions;
// "Add company" creates a tenant and invites its admin.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { usePreview } from "@/lib/preview/store";
import { hrs } from "@/lib/preview/engine";
import type { CompanyStatus } from "@/lib/preview/types";
import { Button, Card, EmptyState, PageHeader, inputCls, timeAgo } from "@/components/preview/ui";
import { CompanyStatusBadge, PlanBadge, STATUS_META, SeatUsage, liveCompanies } from "@/components/preview/platform/shared";
import CompanyDrawer from "@/components/preview/platform/CompanyDrawer";
import AddCompanyModal from "@/components/preview/platform/AddCompanyModal";

export default function CompaniesPage() {
  // useSearchParams() needs a Suspense boundary in this Next.js version.
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading companies…</p>}>
      <Companies />
    </Suspense>
  );
}

function Companies() {
  const { state } = usePreview();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CompanyStatus | "all">("all");
  const [adding, setAdding] = useState(false);
  // ?open=<id> (from the overview page) opens that company's drawer directly.
  const [openId, setOpenId] = useState<string | null>(params.get("open"));

  const companies = liveCompanies(state);
  const term = q.trim().toLowerCase();
  const rows = companies.filter(
    (c) =>
      (status === "all" || c.status === status) &&
      (!term || [c.name, c.industry, c.adminName, c.adminEmail, c.country].some((v) => v.toLowerCase().includes(term)))
  );
  const selected = companies.find((c) => c.id === openId) ?? null;

  const closeDrawer = () => {
    setOpenId(null);
    if (params.get("open")) router.replace(pathname);
  };

  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle={`${companies.length} companies on the platform. Each one has its own separate workspace.`}
        actions={<Button onClick={() => setAdding(true)}>+ Add company</Button>}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, industry, admin or country…" className={`${inputCls} sm:max-w-sm`} aria-label="Search companies" />
        <select value={status} onChange={(e) => setStatus(e.target.value as CompanyStatus | "all")} className={`${inputCls} sm:w-48`} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_META) as CompanyStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label} ({companies.filter((c) => c.status === s).length})</option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="🔍" title="No companies match" body="Try a different search or status filter." />
      ) : (
        <>
          {/* Desktop: table */}
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">People / seats</th>
                  <th className="px-4 py-2.5 text-right font-medium">Active projects</th>
                  <th className="px-4 py-2.5 text-right font-medium">Hours this month</th>
                  <th className="px-4 py-2.5 font-medium">Admin</th>
                  <th className="px-4 py-2.5 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setOpenId(c.id)}
                    onKeyDown={(e) => e.key === "Enter" && setOpenId(c.id)}
                    tabIndex={0}
                    className="cursor-pointer hover:bg-slate-50 focus:bg-indigo-50 focus:outline-none"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.industry} · {c.country}</div>
                    </td>
                    <td className="px-4 py-3"><PlanBadge plan={c.plan} /></td>
                    <td className="px-4 py-3"><CompanyStatusBadge status={c.status} /></td>
                    <td className="px-4 py-3"><SeatUsage users={c.users} seats={c.seats} compact /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.activeProjects}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{hrs(c.hoursThisMonth)}</td>
                    <td className="px-4 py-3">
                      <div className="text-slate-800">{c.adminName}</div>
                      <div className="text-xs text-slate-500">{c.adminEmail}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{timeAgo(c.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((c) => (
              <button key={c.id} onClick={() => setOpenId(c.id)} className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.industry} · {c.country}</p>
                  </div>
                  <CompanyStatusBadge status={c.status} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><SeatUsage users={c.users} seats={c.seats} /></div>
                  <div><span className="block text-slate-400">Projects</span><span className="font-medium text-slate-800">{c.activeProjects}</span></div>
                  <div><span className="block text-slate-400">Hours (month)</span><span className="font-medium text-slate-800">{hrs(c.hoursThisMonth)}</span></div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="truncate">{c.adminName} · {timeAgo(c.lastActiveAt)}</span>
                  <PlanBadge plan={c.plan} />
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <CompanyDrawer key={selected?.id ?? "none"} company={selected} onClose={closeDrawer} />
      <AddCompanyModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
