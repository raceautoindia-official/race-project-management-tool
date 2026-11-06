"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { apiFetch } from "@/lib/api-client";
import { WEEKDAYS, describeSchedule, upcoming, weekdayOf, type Frequency, type Weekday } from "@/lib/recurrence";
import type { RuleDto } from "@/lib/recurring";

/**
 * Set up or edit a recurring task: where it lives (a project, or a new one
 * of its own), who owns each copy, the schedule, its subtasks, and what to
 * do if the last copy is still open. An admin also says whether copies need
 * review; anyone else's goes to an admin, who decides that on approval.
 */

interface Person {
  id: number;
  name: string;
}
interface Options {
  projects: { id: number; name: string; members: Person[] }[];
  people: Person[];
}

const NEW_PROJECT = -1;

function pretty(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900";
const label = "block text-sm font-medium text-slate-700";

export default function RecurringForm({
  rule,
  me,
  today,
  defaultProjectId,
  onClose,
}: {
  rule: RuleDto | null;
  me: { id: number; isAdmin: boolean };
  today: string;
  defaultProjectId: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [opts, setOpts] = useState<Options | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(rule?.title ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [projectId, setProjectId] = useState<number | null>(rule ? (rule.projectId ?? NEW_PROJECT) : defaultProjectId);
  const [newProjectName, setNewProjectName] = useState(rule?.newProjectName ?? "");
  const [ownerId, setOwnerId] = useState<number | null>(rule?.ownerId ?? me.id);
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? "weekly");
  const [interval, setInterval] = useState(rule?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<Weekday[]>(rule?.frequency === "weekly" ? rule.weekdays : [weekdayOf(today) === "Sun" ? "Mon" : weekdayOf(today)]);
  const [monthDay, setMonthDay] = useState<number>(rule?.frequency === "monthly" ? (rule.monthDay ?? 0) : Number(today.slice(8, 10)));
  const [startDate, setStartDate] = useState(rule?.startDate ?? today);
  const [endDate, setEndDate] = useState(rule?.endDate ?? "");
  const [dueAfterDays, setDueAfterDays] = useState(rule?.dueAfterDays ?? 0);
  const [whenOpen, setWhenOpen] = useState<"skip" | "create">(rule?.whenOpen ?? "skip");
  const [reviewMode, setReviewMode] = useState<"review" | "none" | "">(rule?.reviewMode ?? "");
  const [priority, setPriority] = useState(rule?.priority ?? "medium");
  const [estimatedHours, setEstimatedHours] = useState(rule?.estimatedHours != null ? String(rule.estimatedHours) : "");
  const [subtasks, setSubtasks] = useState<{ title: string; assigneeId: number | null }[]>(
    rule?.subtasks.map((s) => ({ title: s.title, assigneeId: s.assigneeId })) ?? []
  );

  useEffect(() => {
    apiFetch<Options>("/api/recurring/options")
      .then(setOpts)
      .catch(() => setError("Couldn't load your projects — close this and try again"));
  }, []);

  const isNewProject = projectId === NEW_PROJECT;
  const people: Person[] = useMemo(() => {
    if (!opts) return [];
    if (isNewProject) return opts.people;
    return opts.projects.find((p) => p.id === projectId)?.members ?? [];
  }, [opts, projectId, isNewProject]);

  const schedule = { frequency, interval, weekdays, monthDay: frequency === "monthly" ? monthDay : null, startDate, endDate: endDate || null };
  const preview = frequency === "weekly" && !weekdays.length ? [] : upcoming(schedule, startDate < today ? today : startDate, 4);
  const editingApproved = rule?.approvalStatus === "approved";
  const showReview = me.isAdmin && (!rule || editingApproved);

  function toggleDay(d: Weekday) {
    setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || w.includes(x))));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!projectId) return setError("Choose where it goes");
    if (isNewProject && !newProjectName.trim()) return setError("Name the new project");
    if (!ownerId) return setError("Choose who owns each copy");
    if (showReview && !reviewMode) return setError("Say whether each copy needs review");
    setBusy(true);
    try {
      const body = {
        projectId: isNewProject ? null : projectId,
        newProjectName: isNewProject ? newProjectName.trim() : null,
        title,
        description: description || null,
        priority,
        ownerId,
        estimatedHours: estimatedHours === "" ? null : Number(estimatedHours),
        frequency,
        interval,
        weekdays: frequency === "weekly" ? weekdays : [],
        monthDay: frequency === "monthly" ? monthDay : null,
        startDate,
        endDate: endDate || null,
        dueAfterDays,
        whenOpen,
        reviewMode: showReview ? reviewMode : null,
        subtasks: subtasks.filter((s) => s.title.trim()),
      };
      await apiFetch(rule ? `/api/recurring/${rule.id}` : "/api/recurring", {
        method: rule ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      toast(
        rule
          ? `Saved “${title}”. Copies already made are unchanged.`
          : me.isAdmin
            ? `“${title}” is set up${preview[0] ? ` — first copy ${preview[0] === today ? "today" : pretty(preview[0])}` : ""}`
            : `Sent “${title}” to an admin for approval`
      );
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={rule ? "Edit recurring task" : "New recurring task"} widthClass="max-w-2xl">
      <form onSubmit={save} className="space-y-5">
        {!me.isAdmin && !rule && (
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
            An admin approves this before its first copy is made, and decides then whether each copy needs review.
          </p>
        )}

        <div>
          <label className={label} htmlFor="rt-title">
            What needs doing
          </label>
          <input id="rt-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="e.g. Weekly stock report" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="rt-project">
              Where it goes
            </label>
            <select
              id="rt-project"
              value={projectId ?? ""}
              disabled={Boolean(rule?.projectId)}
              onChange={(e) => {
                const v = Number(e.target.value) || null;
                setProjectId(v);
                const members = v === NEW_PROJECT ? opts?.people : opts?.projects.find((p) => p.id === v)?.members;
                if (members && ownerId && !members.some((m) => m.id === ownerId)) setOwnerId(null);
              }}
              className={input}
            >
              <option value="">{opts ? "Choose a project…" : "Loading…"}</option>
              {opts?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value={NEW_PROJECT}>＋ A new project of its own</option>
            </select>
            {isNewProject && (
              <input
                aria-label="New project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                maxLength={200}
                className={input}
                placeholder="e.g. Accounts — routine filings"
              />
            )}
            <p className="mt-1 text-xs text-slate-500">
              {isNewProject ? "For ongoing work that isn’t part of a project. It’s created when this is approved." : "Copies don’t change the project’s progress bar."}
            </p>
          </div>
          <div>
            <label className={label} htmlFor="rt-owner">
              Owner of each copy
            </label>
            <select id="rt-owner" value={ownerId ?? ""} onChange={(e) => setOwnerId(Number(e.target.value) || null)} className={input}>
              <option value="">Choose…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === me.id ? " (me)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">Copies follow this person’s working days and holidays in WorkLens.</p>
          </div>
        </div>

        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-800">Repeats</legend>
          <div role="radiogroup" aria-label="How often" className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
            {(["daily", "weekly", "monthly"] as Frequency[]).map((f) => (
              <button
                type="button"
                role="radio"
                aria-checked={frequency === f}
                key={f}
                onClick={() => setFrequency(f)}
                className={`rounded-md px-3 py-1 font-medium ${frequency === f ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {f === "daily" ? "Every working day" : f === "weekly" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>

          {frequency === "weekly" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex gap-1" role="group" aria-label="Days of the week">
                {WEEKDAYS.map((d) => (
                  <button
                    type="button"
                    key={d}
                    aria-pressed={weekdays.includes(d)}
                    onClick={() => toggleDay(d)}
                    className={`h-9 w-11 rounded-lg border text-xs font-semibold ${weekdays.includes(d) ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                every
                <select value={interval} onChange={(e) => setInterval(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "week" : `${n} weeks`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {frequency === "monthly" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <label className="flex items-center gap-1.5">
                on
                <select value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      day {d}
                    </option>
                  ))}
                  <option value={0}>the last day</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                every
                <select value={interval} onChange={(e) => setInterval(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                  {[1, 2, 3, 6, 12].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "month" : n === 3 ? "3 months (quarterly)" : n === 12 ? "12 months (yearly)" : `${n} months`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-slate-600">
              Starts
              <input type="date" required min={rule ? undefined : today} value={startDate} onChange={(e) => setStartDate(e.target.value)} className={input} />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Ends <span className="font-normal text-slate-400">(optional)</span>
              <input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} className={input} />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Due
              <select value={dueAfterDays} onChange={(e) => setDueAfterDays(Number(e.target.value))} className={input}>
                <option value={0}>the same day</option>
                {[1, 2, 3, 5, 7, 14].map((n) => (
                  <option key={n} value={n}>
                    {n} day{n === 1 ? "" : "s"} after
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="mt-3 text-sm text-slate-800">
            <span className="font-medium">{frequency === "weekly" && !weekdays.length ? "Choose a day" : describeSchedule(schedule)}</span>
            {preview.length > 0 && <span className="text-slate-500"> — next: {preview.map(pretty).join(", ")}</span>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {frequency === "daily"
              ? "Holidays and the owner’s days off are skipped."
              : "A date on a holiday or day off moves to the owner’s next working day."}
          </p>
        </fieldset>

        <fieldset>
          <legend className={label}>If the last copy is still open</legend>
          <div className="mt-1 space-y-1">
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="when-open" checked={whenOpen === "skip"} onChange={() => setWhenOpen("skip")} className="mt-1" />
              <span>
                Don’t make a new one <span className="text-xs text-emerald-700">(recommended)</span>
                <span className="block text-xs text-slate-500">Work doesn’t pile up; the owner is told the old copy is still open.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="when-open" checked={whenOpen === "create"} onChange={() => setWhenOpen("create")} className="mt-1" />
              <span>
                Make it anyway
                <span className="block text-xs text-slate-500">For work where every date counts on its own, e.g. a daily log.</span>
              </span>
            </label>
          </div>
        </fieldset>

        <div>
          <div className="flex items-center justify-between">
            <span className={label}>Subtasks every copy starts with</span>
            <button
              type="button"
              onClick={() => setSubtasks((s) => [...s, { title: "", assigneeId: null }])}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              + Add subtask
            </button>
          </div>
          {subtasks.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">None — the copy is a single task for its owner. Add steps to split it up, give them to different people, and time each one.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {subtasks.map((s, i) => (
                <li key={i} className="flex flex-wrap gap-2">
                  <input
                    aria-label={`Subtask ${i + 1}`}
                    value={s.title}
                    maxLength={200}
                    onChange={(e) => setSubtasks((all) => all.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    className="min-w-0 flex-1 basis-48 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    placeholder={`Step ${i + 1}`}
                  />
                  <select
                    aria-label={`Who does subtask ${i + 1}`}
                    value={s.assigneeId ?? ""}
                    onChange={(e) => setSubtasks((all) => all.map((x, j) => (j === i ? { ...x, assigneeId: Number(e.target.value) || null } : x)))}
                    className="w-44 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">The copy’s owner</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setSubtasks((all) => all.filter((_, j) => j !== i))}
                    className="rounded-lg px-2 text-slate-400 hover:text-red-600"
                    aria-label={`Remove subtask ${i + 1}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-xs font-medium text-slate-600">
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={input}>
              {["low", "medium", "high", "urgent"].map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Estimate (hours)
            <input type="number" min={0} step={0.25} value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} className={input} />
          </label>
          <label className="text-xs font-medium text-slate-600 sm:col-span-3">
            Notes for whoever does it <span className="font-normal text-slate-400">(optional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={5000} className={input} />
          </label>
        </div>

        {showReview && (
          <fieldset className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-800">Does each copy need review?</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="review" checked={reviewMode === "review"} onChange={() => setReviewMode("review")} className="mt-1" />
              <span>
                Yes, review each copy
                <span className="block text-xs text-slate-500">The normal review and sign-off.</span>
              </span>
            </label>
            <label className="mt-1 flex items-start gap-2 text-sm">
              <input type="radio" name="review" checked={reviewMode === "none"} onChange={() => setReviewMode("none")} className="mt-1" />
              <span>
                No regular review needed
                <span className="block text-xs text-slate-500">Marking a copy complete finishes and signs it off.</span>
              </span>
            </label>
          </fieldset>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={busy || !opts} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "Saving…" : rule ? "Save changes" : me.isAdmin ? "Start it" : "Send for approval"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
