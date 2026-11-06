"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ToastProvider";
import { apiFetch } from "@/lib/api-client";
import type { HistoryItem, RuleDto } from "@/lib/recurring";
import RecurringForm from "./RecurringForm";

/**
 * The Recurring page: rules grouped by where they stand, each with its
 * schedule, next copy, recent history and the actions this person may take.
 * An admin approves proposals here, deciding then whether copies need review.
 */

type Me = { id: number; isAdmin: boolean };
type Scope = "mine" | "all";

const HISTORY: Record<HistoryItem["state"], { cls: string; label: string }> = {
  done: { cls: "bg-emerald-500", label: "Done on time" },
  late: { cls: "bg-amber-500", label: "Done late" },
  review: { cls: "bg-sky-400", label: "Waiting for review" },
  open: { cls: "bg-white ring-2 ring-inset ring-indigo-400", label: "Open" },
  overdue: { cls: "bg-red-500", label: "Open and overdue" },
  holiday: { cls: "bg-slate-200", label: "Holiday — no copy" },
  day_off: { cls: "bg-slate-200", label: "Day off — no copy" },
  still_open: { cls: "bg-orange-300", label: "No copy — the last one was still open" },
  missed: { cls: "bg-slate-400", label: "Missed — the app was down" },
  skipped: { cls: "bg-slate-300", label: "Skipped by hand" },
};

function pretty(d: string | null): string {
  if (!d) return "";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export default function RecurringView({
  rules,
  me,
  today,
  focusRuleId,
  projectId,
  openNew,
}: {
  rules: RuleDto[];
  me: Me;
  today: string;
  focusRuleId: number | null;
  projectId: number | null;
  openNew: boolean;
}) {
  const [scope, setScope] = useState<Scope>(() => (me.isAdmin || projectId || focusRuleId ? "all" : "mine"));
  const [editing, setEditing] = useState<RuleDto | "new" | null>(openNew ? "new" : null);
  const [projectFilter, setProjectFilter] = useState<number | null>(projectId);

  useEffect(() => {
    if (!focusRuleId) return;
    document.getElementById(`rule-${focusRuleId}`)?.scrollIntoView({ block: "center" });
  }, [focusRuleId]);

  const visible = useMemo(
    () =>
      rules.filter(
        (r) =>
          (scope === "all" || r.mine || r.createdBy === me.id) &&
          (!projectFilter || r.projectId === projectFilter || r.id === focusRuleId)
      ),
    [rules, scope, me.id, projectFilter, focusRuleId]
  );
  const groups: { key: string; title: string; hint?: string; items: RuleDto[] }[] = [
    {
      key: "pending",
      title: me.isAdmin ? "Waiting for your approval" : "Waiting for an admin",
      hint: me.isAdmin ? "Approve each once. You decide here whether its copies need review." : "An admin approves a recurring task before its first copy is made.",
      items: visible.filter((r) => r.approvalStatus === "pending"),
    },
    { key: "running", title: "Running", items: visible.filter((r) => r.approvalStatus === "approved" && r.isActive) },
    { key: "stopped", title: "Paused and ended", items: visible.filter((r) => r.approvalStatus === "approved" && !r.isActive) },
    { key: "rejected", title: "Not approved", items: visible.filter((r) => r.approvalStatus === "rejected") },
  ];
  const filteredProject = projectFilter ? rules.find((r) => r.projectId === projectFilter)?.projectName : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Which recurring tasks" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {(["mine", "all"] as Scope[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              className={`rounded-md px-3 py-1.5 font-medium ${scope === s ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {s === "mine" ? "Mine" : me.isAdmin ? "Everyone's" : "All I can see"}
            </button>
          ))}
        </div>
        {projectFilter && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
            In {filteredProject ?? "this project"}
            <button onClick={() => setProjectFilter(null)} className="ml-1 text-indigo-500 hover:text-indigo-800" aria-label="Show every project">
              ✕
            </button>
          </span>
        )}
        <button
          onClick={() => setEditing("new")}
          className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          + New recurring task
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <div className="text-3xl" aria-hidden>
            ↻
          </div>
          <p className="mt-2 text-sm font-medium text-slate-800">
            {scope === "mine" ? "No recurring work comes to you yet" : "No recurring tasks yet"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Set up anything that repeats — a daily stock check, a weekly report, a monthly filing. Each copy arrives on
            the owner’s working days, with its subtasks already assigned.
          </p>
          <button onClick={() => setEditing("new")} className="mt-4 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            + New recurring task
          </button>
        </div>
      ) : (
        groups
          .filter((g) => g.items.length)
          .map((g) => (
            <section key={g.key} aria-labelledby={`g-${g.key}`}>
              <h2 id={`g-${g.key}`} className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {g.title} · {g.items.length}
              </h2>
              {g.hint && <p className="mb-2 text-xs text-slate-500">{g.hint}</p>}
              <ul className="space-y-3">
                {g.items.map((r) => (
                  <RuleCard key={r.id} rule={r} me={me} today={today} focused={r.id === focusRuleId} onEdit={() => setEditing(r)} />
                ))}
              </ul>
            </section>
          ))
      )}

      <Legend />

      {editing && (
        <RecurringForm
          rule={editing === "new" ? null : editing}
          me={me}
          today={today}
          defaultProjectId={projectFilter}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Legend() {
  const shown: HistoryItem["state"][] = ["done", "late", "review", "open", "overdue", "still_open", "holiday", "skipped"];
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {shown.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${HISTORY[k].cls}`} />
          {HISTORY[k].label}
        </span>
      ))}
    </p>
  );
}

function RuleCard({ rule: r, me, today, focused, onEdit }: { rule: RuleDto; me: Me; today: string; focused: boolean; onEdit: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"end" | "delete" | null>(null);
  const [showSubs, setShowSubs] = useState(false);

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/recurring/${r.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast(done);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work — please try again", "error");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiFetch(`/api/recurring/${r.id}`, { method: "DELETE" });
      toast(`Deleted “${r.title}”. Its copies stay.`);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work — please try again", "error");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const running = r.approvalStatus === "approved" && r.isActive;
  const btn = "rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
  const history = [...r.history].reverse();

  return (
    <li
      id={`rule-${r.id}`}
      className={`scroll-mt-24 rounded-2xl border bg-white p-4 shadow-sm ${focused ? "border-indigo-400 ring-2 ring-indigo-200" : "border-slate-200"}`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="text-lg text-violet-600">
              ↻
            </span>
            <h3 className="text-base font-semibold text-slate-900">{r.title}</h3>
            {r.reviewMode === "none" && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">No review needed</span>}
            {r.reviewMode === "review" && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">Each copy reviewed</span>}
            {!r.isActive && r.approvalStatus === "approved" && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{r.pausedReason ?? "Paused"}</span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-700">
            {r.schedule}
            {r.dueAfterDays > 0 && <span className="text-slate-500"> · due {r.dueAfterDays} day{r.dueAfterDays === 1 ? "" : "s"} after</span>}
            {r.endDate && <span className="text-slate-500"> · until {pretty(r.endDate)}</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
            {r.projectId ? (
              <Link href={`/projects/${r.projectId}`} className="hover:text-indigo-700 hover:underline">
                {r.projectName}
              </Link>
            ) : (
              <span>New project: {r.newProjectName}</span>
            )}
            <span>· Owner {r.ownerName ?? "—"}</span>
            {r.createdByName && <span>· Set up by {r.createdByName}</span>}
          </p>
        </div>

        <div className="w-full text-sm sm:w-56 sm:text-right">
          {running && r.next ? (
            <>
              <span className="text-xs text-slate-500">Next copy</span>
              <span className="block font-semibold text-slate-900">{r.next === today ? "Today" : pretty(r.next)}</span>
              {r.nextNote && <span className="block text-xs text-amber-700">{r.nextNote}</span>}
              {r.skippingNext && <span className="block text-xs text-slate-500">{pretty(r.skippingNext)} is skipped</span>}
            </>
          ) : r.approvalStatus === "pending" ? (
            <span className="text-xs font-medium text-amber-700">Waiting for approval</span>
          ) : r.approvalStatus === "rejected" ? (
            <span className="text-xs text-red-700">Not approved{r.decisionNote ? `: “${r.decisionNote}”` : ""}</span>
          ) : null}
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ol className="flex items-center gap-1.5" aria-label="Recent copies, oldest first">
            {history.map((h) => {
              const dot = <span className={`block h-3 w-3 rounded-full ${HISTORY[h.state].cls}`} />;
              const label = `${pretty(h.date)}: ${HISTORY[h.state].label}`;
              return (
                <li key={`${h.date}-${h.state}`} title={label}>
                  {h.taskId && r.projectId ? (
                    <Link href={`/projects/${r.projectId}?task=${h.taskId}`} aria-label={label}>
                      {dot}
                    </Link>
                  ) : (
                    <span aria-label={label}>{dot}</span>
                  )}
                </li>
              );
            })}
          </ol>
          {r.onTime.done > 0 && (
            <span className="text-xs text-slate-500">
              {r.onTime.onTime} of {r.onTime.done} done on time
            </span>
          )}
          {r.openCopies > 0 && (
            <span className="text-xs font-medium text-orange-700">
              {r.openCopies} open cop{r.openCopies === 1 ? "y" : "ies"}
              {r.whenOpen === "skip" ? " — no new one until it's done" : ""}
            </span>
          )}
        </div>
      )}

      {r.subtasks.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowSubs((v) => !v)} className="text-xs font-medium text-indigo-600 hover:underline" aria-expanded={showSubs}>
            {showSubs ? "Hide" : "Show"} {r.subtasks.length} subtask{r.subtasks.length === 1 ? "" : "s"}
          </button>
          {showSubs && (
            <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
              {r.subtasks.map((s) => (
                <li key={s.id} className="flex gap-2">
                  <span aria-hidden className="text-slate-400">
                    ○
                  </span>
                  {s.title}
                  <span className="text-xs text-slate-500">{s.assigneeName ? `· ${s.assigneeName}` : "· unassigned"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {r.approvalStatus === "pending" && me.isAdmin && <ApprovePanel rule={r} busy={busy} onAct={act} />}

      {(r.canManage || me.isAdmin) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {r.approvalStatus !== "rejected" && (
            <button className={btn} disabled={busy} onClick={onEdit}>
              Edit
            </button>
          )}
          {running && (
            <>
              <button className={btn} disabled={busy} onClick={() => act({ action: "pause" }, `Paused “${r.title}”`)}>
                Pause
              </button>
              {r.skippingNext ? (
                <button className={btn} disabled={busy} onClick={() => act({ action: "unskip" }, "Skip undone")}>
                  Undo skip
                </button>
              ) : (
                <button className={btn} disabled={busy} onClick={() => act({ action: "skip_next" }, "The next copy will be skipped")}>
                  Skip next
                </button>
              )}
            </>
          )}
          {r.approvalStatus === "approved" && !r.isActive && r.pausedReason !== "Ended" && (
            <button className={btn} disabled={busy} onClick={() => act({ action: "resume" }, `Restarted “${r.title}”`)}>
              Resume
            </button>
          )}
          {confirm ? (
            <span className="inline-flex items-center gap-2 text-xs">
              {confirm === "end"
                ? r.approvalStatus === "approved"
                  ? "End it? Copies already made stay."
                  : "Withdraw this proposal?"
                : "Delete it for good? Its copies stay."}
              <button className="rounded-lg bg-red-600 px-2.5 py-1 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => (confirm === "end" ? act({ action: "end" }, r.approvalStatus === "approved" ? `Ended “${r.title}”` : "Withdrawn") : remove())}>
                Yes
              </button>
              <button className={btn} onClick={() => setConfirm(null)}>
                No
              </button>
            </span>
          ) : (
            <>
              {(r.isActive || r.approvalStatus === "pending") && r.pausedReason !== "Ended" && (
                <button className={`${btn} text-red-700`} disabled={busy} onClick={() => setConfirm("end")}>
                  {r.approvalStatus === "approved" ? "End" : "Withdraw"}
                </button>
              )}
              {me.isAdmin && (
                <button className={`${btn} ml-auto text-red-700`} disabled={busy} onClick={() => setConfirm("delete")}>
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function ApprovePanel({ rule, busy, onAct }: { rule: RuleDto; busy: boolean; onAct: (b: Record<string, unknown>, done: string) => void }) {
  const [mode, setMode] = useState<"review" | "none" | "">("");
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-sm font-semibold text-slate-900">Approve this recurring task</p>
      <p className="mt-0.5 text-xs text-slate-600">
        {rule.createdByName ?? "Someone"} proposed it
        {rule.newProjectName ? ` as a new project, “${rule.newProjectName}” — approving it creates that project` : ""}. You only decide this once.
      </p>
      <fieldset className="mt-2 space-y-1.5">
        <legend className="text-xs font-medium text-slate-700">Does each copy need review?</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name={`mode-${rule.id}`} checked={mode === "review"} onChange={() => setMode("review")} className="mt-1" />
          <span>
            <span className="font-medium text-slate-900">Yes, review each copy</span>
            <span className="block text-xs text-slate-500">It goes through the normal review and sign-off, like any task.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name={`mode-${rule.id}`} checked={mode === "none"} onChange={() => setMode("none")} className="mt-1" />
          <span>
            <span className="font-medium text-slate-900">No regular review needed</span>
            <span className="block text-xs text-slate-500">Marking a copy complete finishes and signs it off at once — for routine checks.</span>
          </span>
        </label>
      </fieldset>
      <label className="mt-2 block text-xs font-medium text-slate-700">
        Note <span className="font-normal text-slate-500">(needed if you don’t approve it)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
          placeholder="Anything they should know"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          disabled={busy || !mode}
          onClick={() => onAct({ action: "approve", reviewMode: mode, note: note || null }, `Approved “${rule.title}”`)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          disabled={busy || !note.trim()}
          onClick={() => onAct({ action: "reject", note }, "Sent back with your note")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title={note.trim() ? undefined : "Add a note saying why"}
        >
          Don’t approve
        </button>
      </div>
    </div>
  );
}
