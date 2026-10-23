"use client";

// Platform overview: how many companies there are, how they are doing, and
// which ones need the platform owner's attention today.

import Link from "next/link";
import { usePreview } from "@/lib/preview/store";
import { hrs } from "@/lib/preview/engine";
import { ButtonLink, Card, EmptyState, PageHeader, SectionTitle, timeAgo } from "@/components/preview/ui";
import {
  CompanyStatusBadge,
  PlanBadge,
  SeatUsage,
  StatTile,
  daysSince,
  liveCompanies,
  trialDaysLeft,
} from "@/components/preview/platform/shared";

interface Attention {
  id: string;
  companyId: string;
  icon: string;
  tone: string;
  title: string;
  body: string;
}

export default function PlatformOverviewPage() {
  const { state, me } = usePreview();
  const companies = liveCompanies(state);

  const count = (s: string) => companies.filter((c) => c.status === s).length;
  const users = companies.reduce((n, c) => n + c.users, 0);
  const seats = companies.reduce((n, c) => n + c.seats, 0);
  const hours = companies.reduce((n, c) => n + c.hoursThisMonth, 0);

  // Everything that needs a decision or a nudge, most urgent first.
  const attention: Attention[] = [];
  for (const c of companies) {
    if (c.status === "trial") {
      const left = trialDaysLeft(c);
      if (left <= 7)
        attention.push({
          id: c.id + "-trial", companyId: c.id, icon: "⏳", tone: "bg-sky-50 text-sky-700",
          title: `${c.name}: trial ${left < 0 ? "has ended" : left === 0 ? "ends today" : `ends in ${left} day${left === 1 ? "" : "s"}`}`,
          body: `${c.users} people are using it on the ${c.plan} plan. Reach out before it lapses.`,
        });
    }
    if (c.status === "suspended")
      attention.push({
        id: c.id + "-susp", companyId: c.id, icon: "⛔", tone: "bg-red-50 text-red-700",
        title: `${c.name} is suspended`,
        body: `Nobody at this company can sign in. Last active ${timeAgo(c.lastActiveAt)}.`,
      });
    if (c.status === "onboarding")
      attention.push({
        id: c.id + "-onb", companyId: c.id, icon: "🧭", tone: "bg-amber-50 text-amber-800",
        title: `${c.name} hasn't finished setting up`,
        body: `Invited ${daysSince(c.createdAt) === 0 ? "today" : `${daysSince(c.createdAt)} day(s) ago`} — ${c.adminName} still needs to complete onboarding.`,
      });
    if (c.status !== "suspended" && c.seats > 0 && c.users / c.seats >= 0.85)
      attention.push({
        id: c.id + "-seats", companyId: c.id, icon: "👥", tone: "bg-violet-50 text-violet-700",
        title: `${c.name} is using ${Math.round((c.users / c.seats) * 100)}% of its seats`,
        body: `${c.users} of ${c.seats} seats used. They may need more seats or a bigger plan soon.`,
      });
  }

  const recent = [...companies]
    .filter((c) => c.status !== "onboarding")
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    .slice(0, 5);

  return (
    <div>
      <PageHeader
        title={`Good to see you, ${me.name.split(" ")[0]}`}
        subtitle="A quick look at every company on the platform."
        actions={<ButtonLink href="/preview/platform/companies">Manage companies</ButtonLink>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Companies"
          value={companies.length}
          sub={
            <span className="flex flex-wrap gap-x-2">
              <span className="text-green-700">{count("active")} active</span>
              <span className="text-sky-700">{count("trial")} trial</span>
              <span className="text-red-700">{count("suspended")} suspended</span>
            </span>
          }
        />
        <StatTile
          label="People vs seats"
          value={<>{users.toLocaleString("en-IN")}<span className="text-base text-slate-400"> / {seats.toLocaleString("en-IN")}</span></>}
          sub={`${seats ? Math.round((users / seats) * 100) : 0}% of paid seats in use`}
          tone="indigo"
        />
        <StatTile label="Hours logged this month" value={hrs(hours)} sub="Across every company" />
        <StatTile
          label="Still setting up"
          value={count("onboarding")}
          sub="Invited, onboarding not finished"
          tone={count("onboarding") ? "amber" : "slate"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-2">
          <SectionTitle count={attention.length}>Needs attention</SectionTitle>
          {attention.length === 0 ? (
            <EmptyState icon="✅" title="Nothing needs you right now" body="Trials, suspensions and stuck setups will show up here." />
          ) : (
            <Card className="divide-y divide-slate-100">
              {attention.map((a) => (
                <Link key={a.id} href={`/preview/platform/companies?open=${a.companyId}`} className="flex gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${a.tone}`} aria-hidden>{a.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{a.title}</span>
                    <span className="block text-xs text-slate-500">{a.body}</span>
                  </span>
                </Link>
              ))}
            </Card>
          )}
        </section>

        <section className="lg:col-span-3">
          <SectionTitle action={<Link href="/preview/platform/companies" className="text-sm text-indigo-600 hover:underline">See all</Link>}>
            Recently active
          </SectionTitle>
          <Card className="overflow-hidden">
            {/* Table on wider screens, stacked rows on phones */}
            <table className="hidden w-full text-sm sm:table">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Plan</th>
                  <th className="px-4 py-2 font-medium">Seats</th>
                  <th className="px-4 py-2 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/preview/platform/companies?open=${c.id}`} className="font-medium text-slate-900 hover:text-indigo-600">{c.name}</Link>
                      <div className="mt-0.5"><CompanyStatusBadge status={c.status} /></div>
                    </td>
                    <td className="px-4 py-2.5"><PlanBadge plan={c.plan} /></td>
                    <td className="px-4 py-2.5"><SeatUsage users={c.users} seats={c.seats} compact /></td>
                    <td className="px-4 py-2.5 text-slate-500">{timeAgo(c.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 sm:hidden">
              {recent.map((c) => (
                <li key={c.id}>
                  <Link href={`/preview/platform/companies?open=${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{c.name}</span>
                      <span className="text-xs text-slate-500">{c.plan} · {timeAgo(c.lastActiveAt)}</span>
                    </span>
                    <CompanyStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>
    </div>
  );
}
