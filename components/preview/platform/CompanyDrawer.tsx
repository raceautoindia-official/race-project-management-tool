"use client";

// Slide-over with one company's details and the platform owner's actions on it.

import { useRouter } from "next/navigation";
import { useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { usePreview } from "@/lib/preview/store";
import { hrs } from "@/lib/preview/engine";
import type { Company } from "@/lib/preview/types";
import { Button, Drawer, NotConnectedTag, fmtDate, inputCls, labelCls, timeAgo, useNotConnected } from "@/components/preview/ui";
import { CompanyStatusBadge, PLANS, PLAN_NAMES, PlanBadge, SeatUsage, inr, trialDaysLeft, type PlanName } from "./shared";

export default function CompanyDrawer({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const { updateCompany, switchUser } = usePreview();
  const router = useRouter();
  const { toast } = useToast();
  const notConnected = useNotConnected();
  const [confirm, setConfirm] = useState(false);

  if (!company) return null;
  const c = company;
  const suspended = c.status === "suspended";

  const openWorkspace = (impersonate: boolean) => {
    if (!c.isDemoTenant) {
      toast(`Only Demo Company has sample data in this preview, so ${c.name}'s workspace can't be opened here.`, "info");
      return;
    }
    if (impersonate) toast(`Signed in as ${c.adminName}. This session is recorded in the audit log.`, "info");
    switchUser("u-sanjay");
    router.push("/preview");
  };

  const setStatus = () => {
    updateCompany(c.id, { status: suspended ? "active" : "suspended" });
    toast(suspended ? `${c.name} is active again.` : `${c.name} is suspended. Its people can no longer sign in.`, suspended ? "success" : "info");
  };

  const plan = PLANS[c.plan];
  const monthly = c.users * plan.price;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Company</p>
            <h2 className="text-lg font-semibold text-slate-900">{c.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <CompanyStatusBadge status={c.status} />
              <PlanBadge plan={c.plan} />
              {c.isDemoTenant && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200">Has sample data</span>}
            </div>
          </div>
        }
      >
        <div className="space-y-6 text-sm">
          {c.status === "trial" && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sky-800">
              Trial {trialDaysLeft(c) < 0 ? "ended" : `ends in ${trialDaysLeft(c)} day(s)`}. They&apos;ll need to choose a paid plan to keep going.
            </p>
          )}
          {c.status === "onboarding" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
              {c.adminName} has been invited but hasn&apos;t finished setting up the workspace yet.
            </p>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Detail label="Industry" value={c.industry} />
            <Detail label="Country" value={c.country} />
            <Detail label="Company admin" value={<>{c.adminName}<span className="block truncate text-xs text-slate-500">{c.adminEmail}</span></>} />
            <Detail label="Joined" value={fmtDate(c.createdAt)} />
            <Detail label="Active projects" value={c.activeProjects} />
            <Detail label="Hours this month" value={hrs(c.hoursThisMonth)} />
            <Detail label="Last active" value={timeAgo(c.lastActiveAt)} />
            <Detail label="Estimated bill" value={`${inr(monthly)} / month`} />
          </dl>

          <div>
            <p className={labelCls}>Seats used</p>
            <SeatUsage users={c.users} seats={c.seats} />
          </div>

          <section className="space-y-3 rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Plan & seats</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Plan</span>
                <select
                  value={c.plan}
                  onChange={(e) => {
                    const p = e.target.value as PlanName;
                    updateCompany(c.id, { plan: p });
                    toast(`${c.name} moved to the ${p} plan.`);
                  }}
                  className={inputCls}
                >
                  {PLAN_NAMES.map((p) => (
                    <option key={p} value={p}>{p} — {inr(PLANS[p].price)}/person</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>Seats</span>
                <input
                  type="number"
                  min={1}
                  value={c.seats}
                  onChange={(e) => {
                    const n = Math.max(1, Math.round(Number(e.target.value) || 1));
                    updateCompany(c.id, { seats: n });
                  }}
                  className={inputCls}
                />
              </label>
            </div>
            {plan.seatLimit !== null && c.seats > plan.seatLimit && (
              <p className="text-xs text-amber-700">The {c.plan} plan allows up to {plan.seatLimit} people — consider a bigger plan.</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-slate-900">Actions</h3>
            <ActionRow
              title="Open workspace"
              body={c.isDemoTenant ? "See this company's workspace as its admin." : "Only Demo Company has sample data in this preview."}
              action={<Button size="sm" onClick={() => openWorkspace(false)}>Open</Button>}
            />
            <ActionRow
              title="Impersonate company admin"
              body={<>Act as {c.adminName} to help with support. Every impersonation is recorded in the audit log.</>}
              action={<Button size="sm" variant="secondary" onClick={() => openWorkspace(true)}>Impersonate</Button>}
            />
            <ActionRow
              title="Resend admin invite"
              body={<>Email a fresh sign-up link to {c.adminEmail}. <NotConnectedTag label="Email not connected yet" /></>}
              action={<Button size="sm" variant="secondary" onClick={notConnected("Resending the invite email")}>Resend</Button>}
            />
            <ActionRow
              title={suspended ? "Reactivate company" : "Suspend company"}
              body={suspended ? "Let this company's people sign in again." : "Blocks sign-in for everyone at this company. Their data is kept."}
              action={
                <Button size="sm" variant={suspended ? "success" : "danger"} onClick={() => setConfirm(true)}>
                  {suspended ? "Reactivate" : "Suspend"}
                </Button>
              }
            />
          </section>
        </div>
      </Drawer>

      <Modal open={confirm} onClose={() => setConfirm(false)} title={suspended ? `Reactivate ${c.name}?` : `Suspend ${c.name}?`}>
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            {suspended
              ? `Everyone at ${c.name} will be able to sign in and work again straight away.`
              : `Nobody at ${c.name} will be able to sign in until you reactivate it. Their projects and history are kept safe.`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant={suspended ? "success" : "danger"}
              onClick={() => {
                setStatus();
                setConfirm(false);
              }}
            >
              {suspended ? "Reactivate" : "Suspend"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function ActionRow({ title, body, action }: { title: string; body: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
      <div className="min-w-0">
        <p className="font-medium text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{body}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
