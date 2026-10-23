"use client";

// Reviews — every finished subtask/task must be approved by its owner before it
// counts toward progress, so reviewers get one inbox for all of it.

import Link from "next/link";
import { useState } from "react";
import { usePreview } from "@/lib/preview/store";
import {
  itemById,
  itemLink,
  personById,
  projectById,
  projectProgress,
  reviewerIdFor,
  reviewQueue,
  taskProgress,
  weightOf,
  pct,
  weightLabel,
  hrs,
  loggedHours,
  plannedHours,
} from "@/lib/preview/engine";
import type { PreviewState, WorkItem } from "@/lib/preview/types";
import { Card, EmptyState, PageHeader, PersonChip, StatusPill, Tabs, timeAgo, DueLabel } from "@/components/preview/ui";
import { ItemContext, WorkActions } from "@/components/preview/work";
import { EffortVerdict } from "@/components/preview/ItemPanels";

type Tab = "mine" | "sent" | "approved";

export default function ReviewsPage() {
  const { state, me } = usePreview();
  const [tab, setTab] = useState<Tab>("mine");

  const waiting = reviewQueue(state, me.id).sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
  const sent = state.items.filter((i) => i.status === "in_review" && i.personId === me.id);
  const approved = state.items
    .filter((i) => i.status === "done" && i.approvedBy === me.id)
    .sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""))
    .slice(0, 20);

  return (
    <div>
      <PageHeader
        title="Reviews"
        subtitle="Finished work only counts toward progress after its owner approves it. Approve it, or send it back with a note."
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "mine", label: "Waiting for me", count: waiting.length },
          { key: "sent", label: "I sent for review", count: sent.length },
          { key: "approved", label: "Recently approved by me" },
        ]}
      />

      {tab === "mine" &&
        (waiting.length === 0 ? (
          <EmptyState icon="✅" title="Nothing to review" body="When someone finishes work you own, it appears here for your approval." />
        ) : (
          <div className="space-y-3">
            {waiting.map((i) => <ReviewCard key={i.id} item={i} />)}
          </div>
        ))}

      {tab === "sent" &&
        (sent.length === 0 ? (
          <EmptyState icon="📤" title="Nothing waiting on others" body="Work you mark complete waits here until the owner approves it." />
        ) : (
          <Card className="divide-y divide-slate-100">
            {sent.map((i) => {
              const reviewer = personById(state, reviewerIdFor(state, i));
              return (
                <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={itemLink(state, i.id)} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">{i.title}</Link>
                    <ItemContext item={i} />
                  </div>
                  <span className="text-xs text-slate-500">Waiting for <strong className="text-slate-700">{reviewer?.name}</strong> · {i.submittedAt ? timeAgo(i.submittedAt) : ""}</span>
                </div>
              );
            })}
          </Card>
        ))}

      {tab === "approved" &&
        (approved.length === 0 ? (
          <EmptyState icon="🗂" title="No approvals yet" />
        ) : (
          <Card className="divide-y divide-slate-100">
            {approved.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatusPill status={i.status} />
                <div className="min-w-0 flex-1">
                  <Link href={itemLink(state, i.id)} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">{i.title}</Link>
                  <ItemContext item={i} />
                </div>
                <span className="text-xs text-slate-500">{i.approvedAt ? timeAgo(i.approvedAt) : ""}</span>
                <WorkActions item={i} compact />
              </div>
            ))}
          </Card>
        ))}
    </div>
  );
}

/** What approving this item will do to its parent's bar, in plain numbers. */
function impact(state: PreviewState, item: WorkItem): string {
  const approve = (s: PreviewState): PreviewState => ({
    ...s,
    items: s.items.map((x) => (x.id === item.id ? { ...x, status: "done" as const } : x)),
  });
  if (item.parentId) {
    const parent = itemById(state, item.parentId);
    if (!parent) return "";
    const before = taskProgress(state, parent).approved;
    const after = taskProgress(approve(state), parent).approved;
    return `Approving moves “${parent.title}” from ${pct(before)} to ${pct(after)}.`;
  }
  const project = projectById(state, item.projectId);
  if (!project) return "";
  const before = projectProgress(state, project).approved;
  const after = projectProgress(approve(state), project).approved;
  return `Approving moves “${project.name}” from ${pct(before)} to ${pct(after)}.`;
}

function ReviewCard({ item }: { item: WorkItem }) {
  const { state, terms } = usePreview();
  const comments = state.comments.filter((c) => c.itemId === item.id && c.kind === "comment").slice(-2);
  const kind = item.parentId ? terms.subtask.one : terms.task.one;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{kind} · weight {weightLabel(weightOf(state, item))}</p>
          <Link href={itemLink(state, item.id)} className="mt-0.5 block text-base font-medium text-slate-900 hover:text-indigo-700">{item.title}</Link>
          <ItemContext item={item} />
        </div>
        <div className="flex items-center gap-3">
          <PersonChip id={item.personId} showSubtitle />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>Submitted {item.submittedAt ? timeAgo(item.submittedAt) : "recently"}</span>
        <span>Due <DueLabel date={item.dueDate} status={item.status} /></span>
        <span>{hrs(loggedHours(state, item))} man-hours logged of {plannedHours(state, item) ? hrs(plannedHours(state, item)) : "—"} expected</span>
        {item.estimatedHours != null && <EffortVerdict planned={plannedHours(state, item)} actual={loggedHours(state, item)} />}
      </div>
      {comments.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-2.5">
          {comments.map((c) => (
            <p key={c.id} className="text-xs text-slate-600">
              <strong className="text-slate-700">{personById(state, c.authorId)?.name}:</strong> {c.body}
            </p>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-xs text-indigo-700">{impact(state, item)}</p>
        <WorkActions item={item} />
      </div>
    </Card>
  );
}
