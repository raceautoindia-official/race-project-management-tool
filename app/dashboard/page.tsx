import Link from "next/link";
import { requirePageUser } from "@/lib/page-guard";
import { getMyWork, type WorkItem } from "@/lib/my-work";
import { getRecentActivityFor, getUpcomingMeetings } from "@/lib/dashboard";
import { getMyTasksData } from "@/lib/work-views";
import { todayIST } from "@/lib/work-dates";
import { formatRelative, humanizeAction } from "@/lib/format";
import type { SubtaskStatus } from "@/lib/work-engine";
import AppShell from "@/components/AppShell";
import { PageHeader, SectionCard } from "@/components/Cards";
import MyTasksView from "@/components/MyTasksView";
import IntroStrip from "@/components/work/IntroStrip";
import ReviewActions from "@/components/work/ReviewActions";
import { AttentionRow, ItemContext, MeetingList, PageTabs, itemHref, utcAgo, type MeetingRow } from "@/components/work/items";
import { DateRange, DueLabel, HealthBadge, ProgressLegend, SubtaskStatusBadge, WorkProgress } from "@/components/work/kit";
import DoActions from "@/components/work/DoActions";

export const dynamic = "force-dynamic";

/**
 * My Work — the home page (the address stays /dashboard so sign-in lands
 * here). It answers "what do I need to do next?": reviews waiting on me, my
 * own to-dos, the tasks and projects I own. The old My Tasks list and
 * calendar are the second tab. The old admin dashboard is Reports › Overview.
 */

type View = "work" | "tasks";

/** Whole days from today (IST) to a YYYY-MM-DD date; negative = past. */
function daysFrom(today: string, date: string): number {
  const day = (x: string) => Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10));
  return Math.round((day(String(date).slice(0, 10)) - day(today)) / 86_400_000);
}

function greeting(): string {
  const hour = new Date(Date.now() + 5.5 * 3_600_000).getUTCHours(); // India time
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function MyWorkPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requirePageUser();
  const view: View = (await searchParams).view === "tasks" ? "tasks" : "work";
  const work = await getMyWork(user);
  const today = todayIST();

  const toReview = work.reviewSubtasks.length + work.reviewTasks.length;
  const overdue = work.todo.filter((i) => i.due_date && daysFrom(today, i.due_date) < 0);
  const thisWeek = work.todo.filter((i) => i.due_date && daysFrom(today, i.due_date) >= 0 && daysFrom(today, i.due_date) <= 7);
  const later = work.todo.filter((i) => !i.due_date || daysFrom(today, i.due_date) > 7);
  const changes = work.todo.filter((i) => i.changes_requested);
  const readyToClose = work.ownedProjects.filter((p) => p.ready_to_close);
  const attentionCount = toReview + work.attention.length + changes.length + overdue.length + readyToClose.length;

  const dateLine = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
  const summary =
    attentionCount > 0
      ? `${attentionCount} ${attentionCount === 1 ? "thing needs" : "things need"} your attention. ${dateLine}.`
      : `Nothing urgent right now. ${dateLine}.`;

  return (
    <AppShell user={user}>
      <PageHeader title="My Work" subtitle={`${greeting()}, ${user.name.split(" ")[0]}. ${summary}`} />

      <PageTabs
        label="My Work views"
        active={view}
        tabs={[
          { key: "work", label: "My work", href: "/dashboard" },
          { key: "tasks", label: "My tasks & calendar", href: "/dashboard?view=tasks" },
        ]}
      />

      {view === "tasks" ? (
        <MyTasksTab user={user} />
      ) : (
        <>
          <IntroStrip />

          {/* At-a-glance counters */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Counter label="To review" value={toReview} tone="text-amber-700" href="/reviews" />
            <Counter label="Overdue" value={overdue.length} tone="text-red-600" href="#my-todo" />
            <Counter label="Due this week" value={thisWeek.length} tone="text-indigo-700" href="#my-todo" />
            <Counter label="Waiting on others" value={work.submitted.length} tone="text-slate-700" href="/reviews?tab=sent" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="min-w-0 space-y-6 lg:col-span-2">
              <NeedsAttention work={work} changes={changes} readyToClose={readyToClose} />
              <MyTodo overdue={overdue} thisWeek={thisWeek} later={later} submitted={work.submitted} />
              <OwnedTasks work={work} />
              <OwnedProjects work={work} />
            </div>
            <RightColumn user={user} />
          </div>
        </>
      )}
    </AppShell>
  );
}

function Counter({ label, value, tone, href }: { label: string; value: number; tone: string; href: string }) {
  return (
    <Link href={href} className="block rounded-2xl bg-white p-4 ring-1 ring-slate-200 transition hover:ring-indigo-300">
      <p className={`figure text-2xl font-semibold ${value > 0 ? tone : "text-slate-300"}`}>{value}</p>
      <p className="text-xs font-medium text-slate-500">{label}</p>
    </Link>
  );
}

function Empty({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div className="py-6 text-center">
      <div className="text-2xl" aria-hidden>
        {icon}
      </div>
      <p className="mt-1 text-sm font-medium text-slate-700">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{body}</p>}
    </div>
  );
}

function NeedsAttention({
  work,
  changes,
  readyToClose,
}: {
  work: Awaited<ReturnType<typeof getMyWork>>;
  changes: WorkItem[];
  readyToClose: Awaited<ReturnType<typeof getMyWork>>["ownedProjects"];
}) {
  const reviews = [...work.reviewSubtasks, ...work.reviewTasks];
  const total = reviews.length + work.attention.length + changes.length + readyToClose.length;
  return (
    <SectionCard
      title={`Needs your attention${total ? ` · ${total}` : ""}`}
      action={
        <Link href="/reviews" className="text-sm font-medium text-indigo-600 hover:underline">
          All reviews
        </Link>
      }
    >
      {total === 0 ? (
        <Empty icon="✅" title="Nothing is waiting for you" body="When someone finishes work you own, it shows up here for your approval." />
      ) : (
        <ul className="-my-3 divide-y divide-slate-100">
          {readyToClose.map((p) => (
            <li key={`close-${p.id}`} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700" aria-hidden>
                🏁
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{p.name} is ready to close</p>
                <p className="text-xs text-slate-500">Every task is signed off and no requests are open.</p>
              </div>
              <Link href={`/projects/${p.id}`} className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                Review & close →
              </Link>
            </li>
          ))}
          {reviews.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700" title="Waiting for your review" aria-hidden>
                ⧗
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-500">{i.kind === "subtask" ? "Subtask" : "Task"} to review</p>
                <Link href={itemHref(i)} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">
                  {i.title}
                </Link>
                <p className="text-xs text-slate-500">
                  {i.person_name ?? "Someone"} finished this{i.submitted_at ? ` ${utcAgo(i.submitted_at)}` : ""}
                </p>
                <ItemContext item={i} />
              </div>
              <ReviewActions kind={i.kind} id={i.id} title={i.title} compact />
            </li>
          ))}
          {work.attention.map((a) => (
            <AttentionRow key={`${a.kind}-${a.id}`} a={a} />
          ))}
          {changes.map((i) => (
            <li key={`chg-${i.kind}-${i.id}`} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700" aria-hidden>
                ↩
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-orange-700">Changes requested</p>
                <Link href={itemHref(i)} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">
                  {i.title}
                </Link>
                <p className="text-xs text-orange-800">“{i.changes_requested}”</p>
                <ItemContext item={i} />
              </div>
              <Link href={itemHref(i)} className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                Open →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function MyTodo({ overdue, thisWeek, later, submitted }: { overdue: WorkItem[]; thisWeek: WorkItem[]; later: WorkItem[]; submitted: WorkItem[] }) {
  const count = overdue.length + thisWeek.length + later.length;
  return (
    <section id="my-todo" className="scroll-mt-4">
      <SectionCard title={`My to-do${count ? ` · ${count}` : ""}`}>
        {count === 0 ? (
          <Empty icon="🎉" title="You're all clear" body="Nothing is assigned to you right now. New work appears here as soon as someone gives you some." />
        ) : (
          <div className="space-y-4">
            <TodoGroup title="Overdue" tone="text-red-600" items={overdue} />
            <TodoGroup title="This week" tone="text-slate-700" items={thisWeek} />
            <TodoGroup title="Later" tone="text-slate-500" items={later} />
          </div>
        )}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Sent for review — waiting on others · {submitted.length}
          </h3>
          {submitted.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing waiting. Work you mark complete waits here until its owner approves it.</p>
          ) : (
            <ul className="space-y-2">
              {submitted.map((i) => (
                <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <SubtaskStatusBadge status="review" />
                  <Link href={itemHref(i)} className="min-w-0 truncate font-medium text-slate-700 hover:text-indigo-700">
                    {i.title}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {i.kind === "subtask" ? `waiting for ${i.person_name ?? "the task owner"}` : "waiting for the project owner"}
                    {i.submitted_at ? ` · ${utcAgo(i.submitted_at)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>
    </section>
  );
}

function TodoGroup({ title, tone, items }: { title: string; tone: string; items: WorkItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${tone}`}>
        {title} · {items.length}
      </h3>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {items.map((i) => (
          <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-48">
              <Link href={itemHref(i)} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">
                {i.title}
              </Link>
              <ItemContext item={i} />
            </div>
            <SubtaskStatusBadge status={i.status as SubtaskStatus} />
            <span className="w-32 text-right">
              <DateRange start={i.start_date} due={i.due_date} notStarted={i.status === "todo"} />
            </span>
            <DoActions kind={i.kind} id={i.id} status={i.status} title={i.title} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OwnedTasks({ work }: { work: Awaited<ReturnType<typeof getMyWork>> }) {
  if (work.ownedTasks.length === 0) return null;
  return (
    <SectionCard title={`Tasks I own · ${work.ownedTasks.length}`} action={<span className="hidden sm:block"><ProgressLegend /></span>}>
      <ul className="-my-3 divide-y divide-slate-100">
        {work.ownedTasks.map((t) => (
          <li key={t.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/projects/${t.project_id}/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 hover:text-indigo-700">
                {t.title}
              </Link>
              <DueLabel date={t.due_date} />
            </div>
            <Link href={`/projects/${t.project_id}`} className="text-xs text-slate-500 hover:text-indigo-700 hover:underline">
              {t.project_name}
            </Link>
            <WorkProgress approved={t.progress_approved} pending={t.progress_pending} showLabel label={t.title} className="mt-2" />
            <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
              <span>
                {t.subtask_done}/{t.subtask_total} subtasks approved
              </span>
              {t.waiting_for_me > 0 && <span className="font-medium text-amber-700">{t.waiting_for_me} waiting for your review</span>}
              {t.unassigned > 0 && <span className="font-medium text-orange-600">{t.unassigned} not assigned yet</span>}
            </p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function OwnedProjects({ work }: { work: Awaited<ReturnType<typeof getMyWork>> }) {
  if (work.ownedProjects.length === 0) return null;
  return (
    <SectionCard title={`Projects I own · ${work.ownedProjects.length}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        {work.ownedProjects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="rounded-xl border border-slate-200 p-3 transition hover:border-indigo-300 hover:shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 text-sm font-medium text-slate-900">{p.name}</span>
              <HealthBadge approved={p.percent} start={p.start_date} due={p.due_date} />
            </div>
            <WorkProgress approved={p.percent} showLabel label={p.name} className="mt-3" />
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              <span>
                Due <DueLabel date={p.due_date} />
              </span>
              <span>· {p.task_count} tasks</span>
              {p.ready_to_close && <span className="font-medium text-green-700">· Ready to close</span>}
            </p>
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}

async function RightColumn({ user }: { user: { id: number; role: string } }) {
  const [meetings, activity] = await Promise.all([getUpcomingMeetings(user.id), getRecentActivityFor(user)]);
  return (
    <div className="min-w-0 space-y-6">
      <SectionCard
        title="Upcoming meetings"
        action={
          <Link href="/meetings" className="text-sm font-medium text-indigo-600 hover:underline">
            All
          </Link>
        }
      >
        <MeetingList meetings={meetings as unknown as MeetingRow[]} />
      </SectionCard>
      <SectionCard title="Recent activity">
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="space-y-3">
            {activity.map((a) => (
              <li key={a.id} className="text-sm">
                <span className="font-medium text-slate-800">{a.user_name ?? "System"}</span>{" "}
                <span className="text-slate-600">{humanizeAction(a.action).toLowerCase()}</span>
                <span className="block text-xs text-slate-400">{formatRelative(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

async function MyTasksTab({ user }: { user: Awaited<ReturnType<typeof requirePageUser>> }) {
  const { tasks, projectTasks } = await getMyTasksData(user);
  return (
    <>
      <p className="mb-4 text-sm text-slate-600">Your own tasks, and what else is live on the projects you are on.</p>
      <MyTasksView tasks={tasks} projectTasks={projectTasks} />
    </>
  );
}
