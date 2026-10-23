"use client";

// Task page — a real, shareable URL (instead of the old 950-line modal). The
// subtask list is the centre of the page; clicking a subtask opens it in a side
// panel (`?open=<subtaskId>`, so notifications can deep-link to it).

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { usePreview } from "@/lib/preview/store";
import {
  can,
  effectiveWeights,
  itemById,
  personById,
  projectById,
  reviewerIdFor,
  subtasksOf,
  taskProgress,
  weightOf,
  pct,
  weightLabel,
  hoursSummary,
  hrs,
} from "@/lib/preview/engine";
import type { Project, WorkItem } from "@/lib/preview/types";
import {
  Button,
  Card,
  DueLabel,
  Drawer,
  EmptyState,
  NotConnectedTag,
  PersonChip,
  PriorityTag,
  ProgressBar,
  ProgressLegend,
  SectionTitle,
  StatusPill,
  Tabs,
  fmtDate,
  DateRange,
  useNotConnected,
} from "@/components/preview/ui";
import { AddItemRow, EditItemModal, WeightCell, WeightEditor, WorkActions } from "@/components/preview/work";
import { Discussion, EffortVerdict, FilesPanel, HoursBadge, TimePanel } from "@/components/preview/ItemPanels";

export default function TaskPage() {
  return (
    <Suspense>
      <TaskPageInner />
    </Suspense>
  );
}

function TaskPageInner() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  const { state, terms } = usePreview();
  const project = projectById(state, projectId);
  const task = itemById(state, taskId);
  if (!project || !task || task.parentId) {
    return (
      <EmptyState
        icon="🔍"
        title={`${terms.task.one} not found`}
        body="It may have been deleted, or the demo data was reset."
        action={<Link href={project ? `/preview/projects/${project.id}` : "/preview/projects"} className="text-sm text-indigo-600 hover:underline">← Go back</Link>}
      />
    );
  }
  return <TaskView project={project} task={task} />;
}

type PanelTab = "discussion" | "time" | "files" | "activity";

function TaskView({ project, task }: { project: Project; task: WorkItem }) {
  const { state, me, terms, addSubtask, cancelItem, deleteItem } = usePreview();
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const nc = useNotConnected();
  const openId = params.get("open");
  const [adding, setAdding] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>("discussion");

  const subs = subtasksOf(state, task.id);
  const live = subs.filter((s) => s.status !== "cancelled");
  const weights = effectiveWeights(subs);
  const progress = taskProgress(state, task);
  const target = { project, item: task };
  const canEdit = can(state, me.id, "task.edit", target);
  const canAdd = can(state, me.id, "subtask.create", target);
  const canWeights = can(state, me.id, "subtask.weights", target);
  const reviewer = personById(state, reviewerIdFor(state, task));
  const members = [project.ownerId, ...project.memberIds];
  const taskFields = state.customFields.filter((f) => f.entity === "task");
  const openSub = openId ? subs.find((s) => s.id === openId) ?? null : null;
  const setOpen = (id: string | null) =>
    router.replace(`/preview/projects/${project.id}/tasks/${task.id}${id ? `?open=${id}` : ""}`, { scroll: false });

  const hours = hoursSummary(state, { item: task });
  const counts = {
    approved: live.filter((s) => s.status === "done").length,
    review: live.filter((s) => s.status === "in_review").length,
    unassigned: live.filter((s) => !s.personId).length,
  };

  return (
    <div>
      <nav className="mb-2 flex flex-wrap gap-1 text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/preview/projects" className="hover:text-indigo-600 hover:underline">{terms.project.many}</Link> ›
        <Link href={`/preview/projects/${project.id}`} className="hover:text-indigo-600 hover:underline">{project.name}</Link> ›
      </nav>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{terms.task.one}</p>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{task.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <StatusPill status={task.status} />
                  <PriorityTag priority={task.priority} />
                  <span className="text-xs text-slate-600">{fmtDate(task.startDate)} → {fmtDate(task.dueDate)}</span>
                  <DueLabel date={task.dueDate} status={task.status} />
                  <span className="text-xs text-slate-500" title={`Share of ${project.name}'s progress`}>Counts for <strong>{weightLabel(weightOf(state, task))}</strong> of the {terms.project.one.toLowerCase()}</span>
                </div>
              </div>
              <div className="flex gap-2">
                {canEdit && <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>✎ Edit</Button>}
                {canEdit && task.status !== "cancelled" && task.status !== "done" && (
                  <Button variant="ghost" size="sm" onClick={() => { cancelItem(task.id); toast(`${terms.task.one} cancelled — weights rebalanced`, "info"); }}>Cancel {terms.task.one.toLowerCase()}</Button>
                )}
                {canEdit && <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} aria-label="Delete">🗑</Button>}
              </div>
            </div>
            {task.description && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{task.description}</p>}

            {task.changesRequested && (
              <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                <strong>Changes requested:</strong> {task.changesRequested}
              </div>
            )}

            <div className="mt-5 rounded-lg bg-slate-50 p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <span className="text-2xl font-semibold tabular-nums text-slate-900">{pct(progress.approved)}</span>
                  <span className="ml-2 text-sm text-slate-500">complete (approved)</span>
                </p>
                {subs.length > 0 && (
                  <p className="text-xs text-slate-500">
                    {counts.approved}/{live.length} approved
                    {counts.review > 0 && <span className="text-amber-700"> · {counts.review} waiting for review</span>}
                    {counts.unassigned > 0 && <span className="text-orange-600"> · {counts.unassigned} need an assignee</span>}
                  </p>
                )}
              </div>
              <ProgressBar value={progress} size="lg" />
              <div className="mt-2"><ProgressLegend /></div>
              <div className="mt-3 border-t border-slate-200 pt-3">
                <WorkActions item={task} size="md" />
                {task.status === "in_review" && (
                  <p className="mt-2 text-xs text-slate-500">
                    {subs.length > 0 ? `All ${terms.subtask.many.toLowerCase()} are approved. ` : ""}
                    {reviewer?.id === me.id ? "As the project owner, approve it to count it toward the project." : `${reviewer?.name} (${terms.project.one.toLowerCase()} owner) will review it.`}
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* Subtasks */}
          <Card className="p-5">
            <SectionTitle
              count={live.length}
              action={
                <div className="flex gap-2">
                  {canWeights && live.length > 1 && <Button size="sm" variant="ghost" onClick={() => setWeightsOpen(true)}>⚖ Adjust weights</Button>}
                  {canAdd && task.status !== "cancelled" && !adding && <Button size="sm" onClick={() => setAdding(true)}>+ Add {terms.subtask.one.toLowerCase()}</Button>}
                </div>
              }
            >
              {terms.subtask.many}
            </SectionTitle>

            {subs.length === 0 && !adding && (
              <EmptyState
                icon="🧩"
                title={`No ${terms.subtask.many.toLowerCase()} yet`}
                body={canAdd
                  ? `Split this ${terms.task.one.toLowerCase()} into ${terms.subtask.many.toLowerCase()} and give each one to a person, or just do it yourself and mark it complete.`
                  : `${personById(state, task.personId)?.name ?? "The owner"} is doing this ${terms.task.one.toLowerCase()} directly.`}
                action={canAdd ? <Button onClick={() => setAdding(true)}>+ Split into {terms.subtask.many.toLowerCase()}</Button> : undefined}
              />
            )}

            {subs.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {subs.map((s) => (
                  <li key={s.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 ${s.status === "cancelled" ? "opacity-50" : ""} ${openId === s.id ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
                    <button onClick={() => setOpen(s.id)} className="min-w-0 flex-1 text-left">
                      <span className={`block truncate text-sm font-medium ${s.status === "done" ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900"}`}>{s.title}</span>
                      {s.changesRequested && <span className="text-xs text-orange-600">↩ Changes requested</span>}
                    </button>
                    <span className="w-28"><DateRange start={s.startDate} due={s.dueDate} status={s.status} /></span>
                    <span className="w-20"><HoursBadge item={s} /></span>
                    <WeightCell value={weights.get(s.id) ?? 0} canEdit={canWeights && live.length > 1} onEdit={() => setWeightsOpen(true)} title={`Counts for ${weightLabel(weights.get(s.id) ?? 0)} of this ${terms.task.one.toLowerCase()}.`} />
                    <PersonChip id={s.personId} emptyLabel="Needs assignee" />
                    <StatusPill status={s.status} />
                    <WorkActions item={s} compact />
                  </li>
                ))}
              </ul>
            )}

            {adding && (
              <div className="mt-3">
                <AddItemRow
                  autoFocus
                  placeholder={`${terms.subtask.one} name, e.g. "Collect vendor quotes"`}
                  personLabel="Assign to…"
                  restrictTo={members}
                  defaultStart={task.startDate}
                  onCancel={() => setAdding(false)}
                  onAdd={(v) => {
                    addSubtask(task.id, v);
                    toast(`${terms.subtask.one} added — weights rebalanced`);
                  }}
                />
                <p className="mt-1 text-xs text-slate-500">Press Enter to add and keep going. New items share the weight evenly.</p>
              </div>
            )}
          </Card>

          {/* Discussion etc. */}
          <Card className="p-5">
            <Tabs<PanelTab>
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "discussion", label: "Discussion", count: state.comments.filter((c) => c.itemId === task.id && c.kind === "comment").length },
                { key: "time", label: "Time & man-hours" },
                { key: "files", label: "Files" },
                { key: "activity", label: "Activity" },
              ]}
            />
            {tab === "discussion" && <Discussion item={task} />}
            {tab === "time" && <TimePanel item={task} />}
            {tab === "files" && <FilesPanel />}
            {tab === "activity" && <ItemActivity ids={[task.id, ...subs.map((s) => s.id)]} />}
          </Card>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Details</SectionTitle>
            <dl className="space-y-3 text-sm">
              <Row label={`${terms.task.one} owner`}><PersonChip id={task.personId} size="md" showSubtitle emptyLabel="No owner" /></Row>
              <Row label="Reviewed by"><PersonChip id={reviewer?.id ?? null} size="md" showSubtitle /><span className="mt-0.5 block text-xs text-slate-400">{terms.project.one} owner</span></Row>
              <Row label="Start date">{fmtDate(task.startDate)}</Row>
              <Row label="Due date">{fmtDate(task.dueDate)} <DueLabel date={task.dueDate} status={task.status} /></Row>
              <Row label="Expected hours">
                {hours.planned ? hrs(hours.planned) : "Not set"}
                {subs.length > 0 && <span className="block text-xs text-slate-500">{terms.subtask.many} planned: {hrs(hours.allocated)}{hours.planned && hours.allocated > hours.planned ? " — more than the estimate" : ""}</span>}
              </Row>
              <Row label="Man-hours logged">
                {hrs(hours.logged)}{hours.planned ? <span className="text-xs text-slate-500"> · {Math.round(hours.usedPct)}% used</span> : null}
                {task.status === "done" && <span className="mt-1 block"><EffortVerdict planned={hours.planned} actual={hours.logged} /></span>}
              </Row>
              {taskFields.map((f) => (
                <Row key={f.id} label={f.label}><span className="text-slate-400">—</span></Row>
              ))}
            </dl>
          </Card>
          <Card className="p-5">
            <SectionTitle action={<NotConnectedTag />}>Blocked by</SectionTitle>
            <p className="text-sm text-slate-500">Link {terms.task.many.toLowerCase()} that must finish first. Everyone is warned before starting blocked work.</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={nc("Dependencies")}>+ Add dependency</Button>
          </Card>
          <Card className="p-5">
            <SectionTitle action={<NotConnectedTag />}>Watchers</SectionTitle>
            <p className="text-sm text-slate-500">People who get updates without owning the work.</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={nc("Watchers")}>+ Add watcher</Button>
          </Card>
        </div>
      </div>

      <WeightEditor open={weightsOpen} onClose={() => setWeightsOpen(false)} siblings={subs} parentLabel={task.title} />
      <EditItemModal item={task} open={editOpen} onClose={() => setEditOpen(false)} />
      <SubtaskDrawer item={openSub} project={project} onClose={() => setOpen(null)} />

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title={`Delete ${terms.task.one.toLowerCase()}?`}>
        <p className="text-sm text-slate-600">
          This permanently removes “{task.title}”{subs.length > 0 ? ` and its ${subs.length} ${terms.subtask.many.toLowerCase()}` : ""}. If the work was just dropped, <strong>Cancel</strong> it instead to keep the history.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>Keep it</Button>
          <Button
            variant="danger"
            onClick={() => {
              deleteItem(task.id);
              toast(`${terms.task.one} deleted`, "info");
              router.push(`/preview/projects/${project.id}`);
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  );
}

function ItemActivity({ ids }: { ids: string[] }) {
  const { state } = usePreview();
  const list = state.activity.filter((a) => a.itemId && ids.includes(a.itemId));
  if (list.length === 0) return <p className="text-sm text-slate-500">No activity yet.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {list.map((a) => (
        <li key={a.id} className="text-slate-600">
          <strong className="font-medium text-slate-800">{personById(state, a.actorId)?.name}</strong> {a.text}
        </li>
      ))}
    </ul>
  );
}

// ── Subtask side panel ─────────────────────────────────────────────────────

function SubtaskDrawer({ item, project, onClose }: { item: WorkItem | null; project: Project; onClose: () => void }) {
  const { state, me, terms, cancelItem } = usePreview();
  const { toast } = useToast();
  const [tab, setTab] = useState<"discussion" | "time" | "files">("discussion");
  const [editOpen, setEditOpen] = useState(false);
  if (!item) return null;
  const canEdit = can(state, me.id, "subtask.create", { project, item });
  const reviewer = personById(state, reviewerIdFor(state, item));

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{terms.subtask.one}</p>
            <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusPill status={item.status} />
              <DueLabel date={item.dueDate} status={item.status} />
            </div>
          </div>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <WorkActions item={item} size="md" />
            {canEdit && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>✎ Edit</Button>
                {item.status !== "cancelled" && item.status !== "done" && (
                  <Button size="sm" variant="ghost" onClick={() => { cancelItem(item.id); toast(`${terms.subtask.one} cancelled`, "info"); }}>Cancel it</Button>
                )}
              </div>
            )}
          </div>
        }
      >
        {item.changesRequested && (
          <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
            <strong>Changes requested:</strong> {item.changesRequested}
          </div>
        )}
        <dl className="mb-5 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-xs font-medium text-slate-500">Assigned to</dt><dd className="mt-1"><PersonChip id={item.personId} size="md" showSubtitle emptyLabel="Needs assignee" /></dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Reviewed by</dt><dd className="mt-1"><PersonChip id={reviewer?.id ?? null} size="md" showSubtitle /></dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Weight in {terms.task.one.toLowerCase()}</dt><dd className="mt-1 font-medium">{weightLabel(weightOf(state, item))}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Priority</dt><dd className="mt-1"><PriorityTag priority={item.priority} /></dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Start date</dt><dd className="mt-1">{fmtDate(item.startDate)}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Due date</dt><dd className="mt-1">{fmtDate(item.dueDate)}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Expected hours</dt><dd className="mt-1">{item.estimatedHours != null ? hrs(item.estimatedHours) : "Not set"}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Man-hours logged</dt><dd className="mt-1"><HoursBadge item={item} /></dd></div>
        </dl>
        {item.description && <p className="mb-5 whitespace-pre-wrap text-sm text-slate-600">{item.description}</p>}
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "discussion", label: "Discussion" },
            { key: "time", label: "Time & man-hours" },
            { key: "files", label: "Files" },
          ]}
        />
        {tab === "discussion" && <Discussion item={item} />}
        {tab === "time" && <TimePanel item={item} />}
        {tab === "files" && <FilesPanel />}
      </Drawer>
      <EditItemModal item={item} open={editOpen} onClose={() => setEditOpen(false)} />
    </>
  );
}
