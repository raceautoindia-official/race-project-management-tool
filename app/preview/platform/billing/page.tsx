"use client";

// Plans & billing: the plan catalogue, what each company uses, and invoices.
// Prices and invoices are sample figures — payments need a billing provider.

import { useState } from "react";
import { usePreview } from "@/lib/preview/store";
import { Button, Card, NotConnectedTag, PageHeader, SectionTitle, Tabs, useNotConnected } from "@/components/preview/ui";
import {
  CompanyStatusBadge,
  PLANS,
  PLAN_NAMES,
  PlanBadge,
  SeatUsage,
  StatTile,
  inr,
  liveCompanies,
} from "@/components/preview/platform/shared";

type InvoiceStatus = "Paid" | "Due" | "Overdue";
interface Invoice {
  id: string;
  company: string;
  month: string;
  amount: number;
  status: InvoiceStatus;
}

const INVOICE_STYLE: Record<InvoiceStatus, string> = {
  Paid: "bg-green-50 text-green-700 ring-green-200",
  Due: "bg-amber-50 text-amber-800 ring-amber-200",
  Overdue: "bg-red-50 text-red-700 ring-red-200",
};

export default function BillingPage() {
  const { state } = usePreview();
  const notConnected = useNotConnected();
  const [tab, setTab] = useState<"usage" | "invoices">("usage");
  const companies = liveCompanies(state);
  // Trials and companies still setting up are not billed yet.
  const paying = companies.filter((c) => c.status === "active" || c.status === "suspended");
  const mrr = paying.filter((c) => c.status === "active").reduce((n, c) => n + c.seats * PLANS[c.plan].price, 0);

  // Three months of sample invoices per paying company (billed per seat).
  const invoices: Invoice[] = [];
  const now = new Date();
  for (let m = 0; m < 3; m++) {
    const dt = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const month = dt.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    for (const c of paying) {
      invoices.push({
        id: `INV-${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}-${c.id.slice(3).toUpperCase()}`,
        company: c.name,
        month,
        amount: c.seats * PLANS[c.plan].price,
        status: c.status === "suspended" ? "Overdue" : m === 0 ? "Due" : "Paid",
      });
    }
  }

  return (
    <div>
      <PageHeader
        title="Plans & billing"
        subtitle={<span className="flex flex-wrap items-center gap-2">Sample prices and invoices. <NotConnectedTag label="Payments not connected yet" /></span>}
        actions={<Button variant="secondary" onClick={notConnected("Connecting a payment provider")}>Connect payment provider</Button>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Monthly revenue" value={inr(mrr)} sub="Active companies, billed per seat" tone="indigo" />
        <StatTile label="Paying companies" value={paying.filter((c) => c.status === "active").length} />
        <StatTile label="On trial" value={companies.filter((c) => c.status === "trial").length} tone="amber" />
        <StatTile label="Overdue invoices" value={invoices.filter((i) => i.status === "Overdue").length} tone="red" />
      </div>

      <SectionTitle>Plans</SectionTitle>
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {PLAN_NAMES.map((name) => {
          const p = PLANS[name];
          const onPlan = companies.filter((c) => c.plan === name).length;
          return (
            <Card key={name} className={`flex flex-col p-5 ${name === "Business" ? "ring-2 ring-indigo-500" : ""}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">{name}</h3>
                {name === "Business" && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">Most popular</span>}
              </div>
              <p className="mt-1 text-sm text-slate-500">{p.blurb}</p>
              <p className="mt-3">
                <span className="text-2xl font-semibold text-slate-900">{inr(p.price)}</span>
                <span className="text-sm text-slate-500"> / person / month</span>
              </p>
              <p className="mt-1 text-xs font-medium text-slate-600">{p.seatLimit ? `Up to ${p.seatLimit} seats` : "No seat limit"}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-slate-700">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2"><span className="text-green-600" aria-hidden>✓</span>{f}</li>
                ))}
              </ul>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>{onPlan} {onPlan === 1 ? "company" : "companies"} on this plan</span>
                <Button size="sm" variant="ghost" onClick={notConnected(`Editing the ${name} plan price`)}>Edit price</Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Tabs
        tabs={[
          { key: "usage", label: "Usage by company" },
          { key: "invoices", label: "Invoices", count: invoices.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "usage" ? (
        <Card className="divide-y divide-slate-100">
          {companies.map((c) => {
            const billed = c.status === "active" || c.status === "suspended";
            return (
              <div key={c.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_8rem_9rem_8rem] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{c.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <PlanBadge plan={c.plan} />
                    <CompanyStatusBadge status={c.status} />
                  </div>
                </div>
                <SeatUsage users={c.users} seats={c.seats} />
                <div className="text-sm">
                  <span className="block text-xs text-slate-400">Monthly bill</span>
                  <span className="font-medium text-slate-800">{billed ? inr(c.seats * PLANS[c.plan].price) : "Not billed yet"}</span>
                </div>
                <div className="sm:text-right">
                  <Button size="sm" variant="secondary" onClick={notConnected(`Billing settings for ${c.name}`)}>Billing details</Button>
                </div>
              </div>
            );
          })}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[9rem_1fr_7rem_7rem_6rem_7rem] gap-3 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid">
            <span>Invoice</span><span>Company</span><span>Month</span><span className="text-right">Amount</span><span>Status</span><span />
          </div>
          <ul className="divide-y divide-slate-100">
            {invoices.map((inv) => (
              <li key={inv.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-sm md:grid-cols-[9rem_1fr_7rem_7rem_6rem_7rem] md:items-center">
                <span className="truncate font-mono text-xs text-slate-500">{inv.id}</span>
                <span className="text-right font-medium text-slate-900 md:text-left">{inv.company}</span>
                <span className="text-slate-600">{inv.month}</span>
                <span className="text-right tabular-nums text-slate-800">{inr(inv.amount)}</span>
                <span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${INVOICE_STYLE[inv.status]}`}>{inv.status}</span>
                </span>
                <span className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={notConnected("Downloading invoice PDFs")}>PDF</Button>
                  {inv.status !== "Paid" && <Button size="sm" variant="ghost" onClick={notConnected("Sending a payment reminder")}>Remind</Button>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
