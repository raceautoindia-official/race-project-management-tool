"use client";

// My Work — the home page. Answers "what do I need to do next?" for whoever is
// signed in: reviews waiting on them, their own to-dos, the tasks and projects
// they own, and today's meetings.

import Link from "next/link";
import { useState } from "react";
import { usePreview } from "@/lib/preview/store";
import {
  daysUntil,
  isOverdue,
  itemLink,
  projectHealth,
  projectProgress,
  reviewQueue,
  subtasksOf,
  taskProgress,
  tasksOf,
  todayISO,
  personById,
  hrs,
  personHours,
  weekOf,
} from "@/lib/preview/engine";
import type { WorkItem } from "@/lib/preview/types";
import {
  ButtonLink,
  Card,
  DueLabel,
  EmptyState,
  HealthBadge,
  PersonChip,
  ProgressBar,
  SectionTitle,
  StatusPill,
  timeAgo,
} from "@/components/preview/ui";
import { ItemContext, WorkActions } from "@/components/preview/work";

const INTRO_KEY = "pm-preview-intro-dismissed";

export default function MyWorkPage() {
  const { state, me, terms } = usePreview();
  const today = todayISO();

  const reviews = reviewQueue(state, me.id);
  const isLeaf = (i: WorkItem) => !!i.parentId || subtasksOf(state, i.id).length === 0;
  const mine = state.items.filter((i) => i.personId === me.id && isLeaf(i));
  const todo = mine.filter((i) => i.status === "not_started" || i.status === "in_progress");
  const submitted = mine.filter((i) => i.status === "in_review");
  const changes = todo.filter((i) => i.changesRequested);
  const overdue = todo.filter(isOverdue);
  const thisWeek = todo.filter((i) => !isOverdue(i) && i.dueDate && daysUntil(i.dueDate) <= 7);
  const later = todo.filter((i) => !isOverdue(i) && !(i.dueDate && daysUntil(i.dueDate) <= 7));

  const ownedTasks = state.items.filter((i) => !i.parentId && i.personId === me.id && i.status !== "cancelled" && subtasksOf(state, i.id).length > 0 && i.status !== "done");
  const ownedProjects = state.projects.filter((p) => p.ownerId === me.id && p.state !== "closed");
  const readyToClose = ownedProjects.filter((p) => {
    const live = tasksOf(state, p.id).filter((t) => t.status !== "cancelled");
    return live.length > 0 && live.every((t) => t.status === "done");
  });

  const attentionCount = reviews.length + changes.length + overdue.length + readyToClose.length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const myMeetings = state.meetings
    .filter((m) => m.attendeeIds.includes(me.id) && m.date >= today && daysUntil(m.date) <= 2)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const myReminders = state.reminders.filter((r) => r.personId === me.id && r.date >= today && daysUntil(r.date) <= 7);
  const myProjectIds = new Set(state.projects.filter((p) => p.ownerId === me.id || p.memberIds.includes(me.id)).map((p) => p.id));
  const recent = state.activity.filter((a) => myProjectIds.has(a.projectId)).slice(0, 6);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {greeting}, {me.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {attentionCount > 0
            ? `${attentionCount} ${attentionCount === 1 ? "thing needs" : "things need"} your attention.`
            : "Nothing urgent. Nice work!"}
          {" "}
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      <IntroStrip />

      {/* At-a-glance counters */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="To review" value={reviews.length} tone="amber" href="/preview/reviews" />
        <Stat label="Overdue" value={overdue.length} tone="red" />
        <Stat label="Due this week" value={thisWeek.length} tone="indigo" />
        <Stat label="Waiting on others" value={submitted.length} tone="slate" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Needs attention */}
          {(reviews.length > 0 || changes.length > 0 || readyToClose.length > 0) && (
            <Card className="p-4 sm:p-5">
              <SectionTitle count={reviews.length + changes.length + readyToClose.length}>Needs your attention</SectionTitle>
              <ul className="divide-y divide-slate-100">
                {readyToClose.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">🏁</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{p.name} is ready to close</p>
                      <p className="text-xs text-slate-500">Every {terms.task.one.toLowerCase()} is approved.</p>
                    </div>
                    <ButtonLink href={`/preview/projects/${p.id}`} variant="secondary">Review & close</ButtonLink>
                  </li>
                ))}
                {reviews.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700" title="Waiting for your review">⧗</span>
                    <div className="min-w-0 flex-1">
                      <Link href={itemLink(state, i.id)} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">{i.title}</Link>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <span>{personById(state, i.personId)?.name ?? "Someone"} finished this · {i.submittedAt ? timeAgo(i.submittedAt) : ""}</span>
                        <ItemContext item={i} />
                      </p>
                    </div>
                    <WorkActions item={i} compact />
                  </li>
                ))}
                {changes.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700">↩</span>
                    <div className="min-w-0 flex-1">
                      <Link href={itemLink(state, i.id)} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">Changes requested: {i.title}</Link>
                      <p className="truncate text-xs text-orange-700">“{i.changesRequested}”</p>
                    </div>
                    <WorkActions item={i} compact />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* My to-do */}
          <Card className="p-4 sm:p-5">
            <SectionTitle count={todo.length}>My to-do</SectionTitle>
            {todo.length === 0 ? (
              <EmptyState icon="🎉" title="You're all clear" body={`Nothing is assigned to you right now. New ${terms.subtask.many.toLowerCase()} will appear here as soon as someone gives you one.`} />
            ) : (
              <div className="space-y-4">
                <TodoGroup title="Overdue" tone="text-red-600" items={overdue} />
                <TodoGroup title="This week" tone="text-slate-700" items={thisWeek} />
                <TodoGroup title="Later" tone="text-slate-500" items={later} />
              </div>
            )}
            {submitted.length > 0 && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Sent for review — waiting on others</p>
                <ul className="space-y-1.5">
                  {submitted.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 text-sm">
                      <StatusPill status={i.status} />
                      <Link href={itemLink(state, i.id)} className="truncate text-slate-700 hover:text-indigo-700">{i.title}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {/* Tasks I own */}
          {ownedTasks.length > 0 && (
            <Card className="p-4 sm:p-5">
              <SectionTitle count={ownedTasks.length}>{terms.task.many} I own</SectionTitle>
              <ul className="divide-y divide-slate-100">
                {ownedTasks.map((t) => {
                  const subs = subtasksOf(state, t.id).filter((s) => s.status !== "cancelled");
                  const unassigned = subs.filter((s) => !s.personId).length;
                  const waiting = subs.filter((s) => s.status === "in_review").length;
                  return (
                    <li key={t.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={itemLink(state, t.id)} className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 hover:text-indigo-700">{t.title}</Link>
                        <DueLabel date={t.dueDate} status={t.status} />
                      </div>
                      <ItemContext item={t} />
                      <ProgressBar value={taskProgress(state, t)} showLabel className="mt-2" />
                      <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                        <span>{subs.filter((s) => s.status === "done").length}/{subs.length} {terms.subtask.many.toLowerCase()} approved</span>
                        {waiting > 0 && <span className="font-medium text-amber-700">{waiting} waiting for your review</span>}
                        {unassigned > 0 && <span className="font-medium text-orange-600">{unassigned} not assigned yet</span>}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {/* Projects I own */}
          {ownedProjects.length > 0 && (
            <Card className="p-4 sm:p-5">
              <SectionTitle count={ownedProjects.length}>{terms.project.many} I own</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                {ownedProjects.map((p) => {
                  const h = projectHealth(state, p);
                  return (
                    <Link key={p.id} href={`/preview/projects/${p.id}`} className="rounded-lg border border-slate-200 p-3 transition hover:border-indigo-300 hover:shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">{p.name}</span>
                        <HealthBadge health={h.health} expected={h.expected} />
                      </div>
                      <ProgressBar value={projectProgress(state, p)} showLabel className="mt-3" />
                      <p className="mt-1 text-xs text-slate-500">Due <DueLabel date={p.dueDate} /></p>
                    </Link>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <MyHours />
          <Card className="p-4 sm:p-5">
            <SectionTitle action={<Link href="/preview/calendar" className="text-xs text-indigo-600 hover:underline">Calendar →</Link>}>Coming up</SectionTitle>
            {myMeetings.length === 0 && myReminders.length === 0 ? (
              <p className="text-sm text-slate-500">No meetings or reminders in the next few days.</p>
            ) : (
              <ul className="space-y-3">
                {myMeetings.map((m) => (
                  <li key={m.id} className="flex gap-3">
                    <DateBlock date={m.date} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{m.title}</p>
                      <p className="text-xs text-slate-500">{m.time} · {m.location}</p>
                    </div>
                  </li>
                ))}
                {myReminders.map((r) => (
                  <li key={r.id} className="flex gap-3">
                    <DateBlock date={r.date} tone="amber" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">🔔 {r.title}</p>
                      <p className="text-xs text-slate-500">{r.time} · {r.category}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <SectionTitle>Recent activity</SectionTitle>
            {recent.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing yet.</p>
            ) : (
              <ul className="space-y-3">
                {recent.map((a) => (
                  <li key={a.id} className="flex gap-2 text-sm">
                    <PersonChip id={a.actorId} />
                    <span className="min-w-0 flex-1 text-slate-600">
                      <span className="line-clamp-2">{a.text}</span>
                      <span className="text-xs text-slate-400">{timeAgo(a.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** This week's man-hours against the company work week, with a shortcut to log time. */
function MyHours() {
  const { state, me } = usePreview();
  const week = weekOf(todayISO());
  const h = personHours(state, me.id, week.start, week.end);
  const todayLogged = state.timeLogs.filter((l) => l.personId === me.id && l.date === todayISO()).reduce((s, l) => s + l.hours, 0);
  const tone = h.utilisation > 100 ? "bg-red-500" : h.utilisation >= 60 ? "bg-green-500" : "bg-amber-400";
  return (
    <Card className="p-4 sm:p-5">
      <SectionTitle action={<Link href="/preview/timesheet" className="text-xs text-indigo-600 hover:underline">Timesheet →</Link>}>My hours this week</SectionTitle>
      <p className="text-2xl font-semibold tabular-nums text-slate-900">
        {hrs(h.logged)} <span className="text-sm font-normal text-slate-500">of {hrs(h.capacity)} so far</span>
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" title={`${Math.round(h.utilisation)}% of your working hours this week`}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, h.utilisation)}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {Math.round(h.utilisation)}% utilised · {todayLogged ? `${hrs(todayLogged)} logged today` : "nothing logged today yet"}
      </p>
      <ButtonLink href="/preview/timesheet" variant="secondary" className="mt-3 w-full">+ Log time</ButtonLink>
    </Card>
  );
}

function TodoGroup({ title, tone, items }: { title: string; tone: string; items: WorkItem[] }) {
  const { state } = usePreview();
  if (items.length === 0) return null;
  return (
    <div>
      <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${tone}`}>{title} · {items.length}</p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {items
          .slice()
          .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
          .map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link href={itemLink(state, i.id)} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">{i.title}</Link>
                <div className="flex flex-wrap items-center gap-x-2">
                  <ItemContext item={i} />
                </div>
              </div>
              <StatusPill status={i.status} />
              <span className="w-24 text-right"><DueLabel date={i.dueDate} status={i.status} /></span>
              <WorkActions item={i} compact />
            </li>
          ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, tone, href }: { label: string; value: number; tone: "amber" | "red" | "indigo" | "slate"; href?: string }) {
  const tones = {
    amber: "text-amber-700",
    red: "text-red-600",
    indigo: "text-indigo-700",
    slate: "text-slate-700",
  };
  const body = (
    <Card className={`p-4 ${href ? "transition hover:border-indigo-300" : ""}`}>
      <p className={`text-2xl font-semibold tabular-nums ${value > 0 ? tones[tone] : "text-slate-300"}`}>{value}</p>
      <p className="text-xs font-medium text-slate-500">{label}</p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function DateBlock({ date, tone = "indigo" }: { date: string; tone?: "indigo" | "amber" }) {
  const d = new Date(date + "T00:00:00");
  const cls = tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-indigo-50 text-indigo-700";
  return (
    <div className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg ${cls}`}>
      <span className="text-[10px] font-semibold uppercase leading-none">{d.toLocaleDateString("en-IN", { month: "short" })}</span>
      <span className="text-sm font-bold leading-tight">{d.getDate()}</span>
    </div>
  );
}

/** First-visit explainer of the flow; dismissible and remembered per browser. */
function IntroStrip() {
  const { terms } = usePreview();
  // Safe to read storage while rendering: the preview only renders client-side.
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(INTRO_KEY) !== "1";
    } catch {
      return true;
    }
  });
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      // ignore
    }
  };
  const steps = [
    { icon: "👤", text: `Every ${terms.project.one.toLowerCase()} and ${terms.task.one.toLowerCase()} has one owner` },
    { icon: "🧩", text: `${terms.task.many} are split into ${terms.subtask.many.toLowerCase()} for people to do` },
    { icon: "✅", text: "Finished work goes to the owner for review" },
    { icon: "📈", text: "Approved work moves the progress bars up" },
  ];
  return (
    <div className="mb-6 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-indigo-900">How work flows here</p>
        <button onClick={dismiss} className="text-xs text-indigo-600 hover:underline">Got it, hide this</button>
      </div>
      <ol className="mt-3 grid gap-3 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
            <span className="text-lg leading-none" aria-hidden>{s.icon}</span>
            <span><span className="font-semibold text-indigo-700">{i + 1}.</span> {s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

