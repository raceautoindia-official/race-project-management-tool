import Link from "next/link";
import { requirePageUser } from "@/lib/page-guard";
import { getMyWork, type WorkItem } from "@/lib/my-work";
import { getOutstandingTasks } from "@/lib/work-views";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import OutstandingView from "@/components/OutstandingView";
import ReviewActions from "@/components/work/ReviewActions";
import { AttentionRow, ItemContext, PageTabs, itemHref, utcAgo } from "@/components/work/items";
import { DateRange, PersonLine, SubtaskStatusBadge } from "@/components/work/kit";

export const dynamic = "force-dynamic";

/**
 * Reviews — one inbox for everything waiting on a decision. Finished work only
 * counts toward progress once its owner approves it, so reviewers act here.
 * The "Overdue & in review" tab is the old Outstanding page (/outstanding
 * redirects to it).
 */

const TABS = ["mine", "overdue", "sent", "approved"] as const;
type Tab = (typeof TABS)[number];

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageUser();
  const asked = (await searchParams).tab;
  const tab: Tab = (TABS as readonly string[]).includes(asked ?? "") ? (asked as Tab) : "mine";
  const work = await getMyWork(user);
  const waiting = [...work.reviewSubtasks, ...work.reviewTasks];
  // For an admin this is the organisation's approvals: every request, sign-off,
  // blocker and finished task waiting on a decision they are allowed to make.
  const isAdmin = user.role === "admin";
  const waitingCount = waiting.length + work.attention.length;

  return (
    <AppShell user={user}>
      <PageHeader
        title={isAdmin ? "Approvals" : "Reviews"}
        subtitle={
          isAdmin
            ? "Everything across the organisation that is waiting on a decision you can make — finished work, project and task requests, sign-offs and blockers."
            : "Finished work only counts toward progress once its owner approves it. Approve it, or send it back with a note."
        }
        figures={
          isAdmin
            ? [{ label: "Waiting on a decision", value: waitingCount }]
            : [
                { label: "Waiting for me", value: waitingCount },
                { label: "I sent", value: work.submitted.length },
              ]
        }
      />
      <PageTabs
        label="Review lists"
        active={tab}
        tabs={[
          { key: "mine", label: isAdmin ? "Waiting on a decision" : "Waiting for me", href: "/reviews", count: waitingCount },
          { key: "overdue", label: "Overdue & in review", href: "/reviews?tab=overdue" },
          ...(isAdmin ? [] : [{ key: "sent", label: "I sent", href: "/reviews?tab=sent", count: work.submitted.length }]),
          { key: "approved", label: "Recently approved", href: "/reviews?tab=approved" },
        ]}
      />

      {tab === "mine" && (
        <div className="space-y-6">
          {waiting.length === 0 && work.attention.length === 0 ? (
            <Empty icon="✅" title="Nothing to review" body="When someone finishes work you own, it appears here for your approval." />
          ) : (
            <>
              {waiting.length > 0 && (
                <section aria-labelledby="rv-work" className="space-y-3">
                  <h2 id="rv-work" className="text-sm font-semibold text-slate-700">
                    Finished work to approve · {waiting.length}
                  </h2>
                  {waiting.map((i) => (
                    <ReviewCard key={`${i.kind}-${i.id}`} item={i} />
                  ))}
                </section>
              )}
              {work.attention.length > 0 && (
                <section aria-labelledby="rv-other" className="rounded-2xl bg-white px-4 ring-1 ring-slate-200">
                  <h2 id="rv-other" className="pt-4 text-sm font-semibold text-slate-700">
                    Sign-offs, requests and blockers · {work.attention.length}
                  </h2>
                  <ul className="divide-y divide-slate-100">
                    {work.attention.map((a) => (
                      <AttentionRow key={`${a.kind}-${a.id}`} a={a} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {tab === "overdue" && <OverdueTab user={user} />}

      {tab === "sent" &&
        (work.submitted.length === 0 ? (
          <Empty icon="📤" title="Nothing waiting on others" body="Work you mark complete waits here until its owner approves it." />
        ) : (
          <ItemList
            items={work.submitted}
            aside={(i) =>
              `${i.kind === "subtask" ? `Waiting for ${i.person_name ?? "the task owner"}` : `Waiting for ${i.project_owner_name ?? "the project owner"}`}${
                i.submitted_at ? ` · sent ${utcAgo(i.submitted_at)}` : ""
              }`
            }
          />
        ))}

      {tab === "approved" &&
        (work.recentlyApproved.length === 0 ? (
          <Empty icon="🗂" title="No approvals in the last two weeks" body="Subtasks you approve are listed here for 14 days." />
        ) : (
          <ItemList items={work.recentlyApproved} aside={(i) => (i.person_name ? `Done by ${i.person_name}` : "")} />
        ))}
    </AppShell>
  );
}

function Empty({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white p-10 text-center ring-1 ring-slate-200">
      <div className="text-3xl" aria-hidden>
        {icon}
      </div>
      <p className="mt-2 font-medium text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{body}</p>
    </div>
  );
}

function ReviewCard({ item }: { item: WorkItem }) {
  return (
    <article className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{item.kind === "subtask" ? "Subtask" : "Task"}</p>
          <Link href={itemHref(item)} className="mt-0.5 block text-base font-medium text-slate-900 hover:text-indigo-700">
            {item.title}
          </Link>
          <ItemContext item={item} />
        </div>
        <PersonLine name={item.person_name} empty="No assignee" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>
          {item.person_name ?? "Someone"} finished this{item.submitted_at ? ` ${utcAgo(item.submitted_at)}` : ""}
        </span>
        <DateRange start={item.start_date} due={item.due_date} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-xs text-indigo-700">
          {item.kind === "subtask"
            ? "Approving counts it toward its task's progress."
            : "Approving marks the task done and counts it toward the project."}
        </p>
        <ReviewActions kind={item.kind} id={item.id} title={item.title} />
      </div>
    </article>
  );
}

function ItemList({ items, aside }: { items: WorkItem[]; aside: (i: WorkItem) => string }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
      {items.map((i) => (
        <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <SubtaskStatusBadge status={i.status === "done" ? "done" : "review"} />
          <div className="min-w-0 flex-1 basis-48">
            <Link href={itemHref(i)} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">
              {i.title}
            </Link>
            <ItemContext item={i} />
          </div>
          <span className="text-xs text-slate-500">{aside(i)}</span>
        </li>
      ))}
    </ul>
  );
}

async function OverdueTab({ user }: { user: Awaited<ReturnType<typeof requirePageUser>> }) {
  const tasks = await getOutstandingTasks(user);
  return (
    <>
      <p className="mb-4 text-sm text-slate-600">Overdue work and tasks submitted for review — approve or send back.</p>
      <OutstandingView initial={tasks} />
    </>
  );
}
