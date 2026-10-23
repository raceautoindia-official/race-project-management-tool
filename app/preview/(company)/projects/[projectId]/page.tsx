"use client";

// Project page: who owns it, how far along it is (approved work only), whether
// it's on schedule, and the task tree. Other views sit in tabs.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import Modal from "@/components/Modal";
import { usePreview } from "@/lib/preview/store";
import {
  can,
  projectById,
  projectHealth,
  projectProgress,
  reviewQueue,
  tasksOf,
  pct,
} from "@/lib/preview/engine";
import type { Project } from "@/lib/preview/types";
import {
  Button,
  Card,
  DeptBadge,
  EmptyState,
  HealthBadge,
  NotConnectedTag,
  PersonChip,
  ProgressBar,
  ProgressLegend,
  Tabs,
  fmtDate,
  useNotConnected,
} from "@/components/preview/ui";
import { WeightEditor } from "@/components/preview/work";
import ProjectTree from "@/components/preview/project/ProjectTree";
import {
  ProjectAbout,
  ProjectActivity,
  ProjectHours,
  HoursStrip,
  ProjectBoardView,
  ProjectFiles,
  ProjectTimeline,
} from "@/components/preview/project/ProjectViews";

type Tab = "tasks" | "board" | "timeline" | "hours" | "files" | "activity" | "about";

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { state, terms } = usePreview();
  const project = projectById(state, projectId);
  if (!project) {
    return (
      <EmptyState
        icon="🔍"
        title={`${terms.project.one} not found`}
        body="It may have been deleted, or the demo data was reset."
        action={<Link href="/preview/projects" className="text-sm text-indigo-600 hover:underline">← Back to {terms.project.many.toLowerCase()}</Link>}
      />
    );
  }
  return <ProjectView project={project} />;
}

function ProjectView({ project }: { project: Project }) {
  const { state, me, terms, closeProject } = usePreview();
  const { toast } = useToast();
  const nc = useNotConnected();
  const [tab, setTab] = useState<Tab>("tasks");
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const tasks = tasksOf(state, project.id);
  const live = tasks.filter((t) => t.status !== "cancelled");
  const progress = projectProgress(state, project);
  const health = projectHealth(state, project);
  const isOwner = project.ownerId === me.id;
  const canWeights = can(state, me.id, "task.weights", { project });
  const canClose = can(state, me.id, "project.close", { project });
  const readyToClose = project.state !== "closed" && live.length > 0 && live.every((t) => t.status === "done");
  const myReviews = reviewQueue(state, me.id).filter((i) => i.projectId === project.id).length;

  // Plain-language "your role here" line.
  const myTasks = tasks.filter((t) => t.personId === me.id).length;
  const mySubs = state.items.filter((i) => i.projectId === project.id && i.parentId && i.personId === me.id).length;
  const role = isOwner
    ? `You own this ${terms.project.one.toLowerCase()}: you add ${terms.task.many.toLowerCase()}, set weights and approve finished ${terms.task.many.toLowerCase()}.`
    : myTasks > 0
      ? `You own ${myTasks} ${myTasks === 1 ? terms.task.one.toLowerCase() : terms.task.many.toLowerCase()} here: you split them into ${terms.subtask.many.toLowerCase()} and approve them.`
      : mySubs > 0
        ? `You have ${mySubs} ${mySubs === 1 ? terms.subtask.one.toLowerCase() : terms.subtask.many.toLowerCase()} here. Mark them complete when done and the owner will review.`
        : me.isAdmin
          ? "You're viewing as an admin, so you can change anything."
          : `You're on the team: you can follow progress and comment.`;

  return (
    <div>
      <nav className="mb-2 text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/preview/projects" className="hover:text-indigo-600 hover:underline">{terms.project.many}</Link> ›
      </nav>

      {/* Header card */}
      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{project.name}</h1>
              <HealthBadge health={health.health} expected={health.expected} />
              {project.state === "closed" && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-white">Closed</span>}
              {project.state === "planned" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Planned</span>}
            </div>
            {project.description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{project.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span className="flex items-center gap-2"><span className="text-xs text-slate-400">Owner</span><PersonChip id={project.ownerId} size="md" showSubtitle /></span>
              <DeptBadge id={project.departmentId} />
              <span className="text-xs text-slate-500">{fmtDate(project.startDate)} → {fmtDate(project.dueDate)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWeights && live.length > 1 && <Button variant="secondary" onClick={() => setWeightsOpen(true)}>⚖ Adjust weights</Button>}
            <div className="relative">
              <Button variant="secondary" onClick={() => setMenuOpen((o) => !o)} aria-label="More actions">⋯</Button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg" onMouseLeave={() => setMenuOpen(false)}>
                  <MenuItem onClick={() => { setTab("about"); setMenuOpen(false); }}>Edit details & team</MenuItem>
                  <MenuItem onClick={nc("Importing from Excel")} nc>Import {terms.task.many.toLowerCase()} from Excel</MenuItem>
                  <MenuItem onClick={nc("Exporting to Excel")} nc>Export to Excel</MenuItem>
                  <MenuItem onClick={nc("Recurring work")} nc>Recurring {terms.task.many.toLowerCase()}</MenuItem>
                  <MenuItem onClick={nc("Saving as a template")} nc>Save as template</MenuItem>
                  {canClose && project.state !== "closed" && (
                    <MenuItem onClick={() => { setCloseOpen(true); setMenuOpen(false); }}>Close {terms.project.one.toLowerCase()}…</MenuItem>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-5 rounded-lg bg-slate-50 p-4">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <span className="text-3xl font-semibold tabular-nums text-slate-900">{pct(progress.approved)}</span>
              <span className="ml-2 text-sm text-slate-500">complete (approved)</span>
              {progress.pending > 0.5 && <span className="ml-2 text-sm text-amber-700">+ {pct(progress.pending)} waiting for review</span>}
            </div>
            {health.health !== "done" && health.health !== "not_started" && (
              <span className="text-xs text-slate-500">The schedule says about <strong>{pct(health.expected)}</strong> should be done by today</span>
            )}
          </div>
          <div className="relative">
            <ProgressBar value={progress} size="lg" />
            {health.health !== "done" && health.health !== "not_started" && (
              <div className="absolute -top-1 h-5 w-0.5 bg-slate-700" style={{ left: `${health.expected}%` }} title={`Expected by today: ${pct(health.expected)}`} />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <ProgressLegend />
            <span className="text-xs text-slate-500">
              {live.filter((t) => t.status === "done").length}/{live.length} {terms.task.many.toLowerCase()} approved
              {state.org.progressMode === "approved_tasks" && ` · a ${terms.task.one.toLowerCase()} counts once the owner approves it`}
            </span>
          </div>
        </div>

        <HoursStrip project={project} onOpen={() => setTab("hours")} />

        <p className="mt-3 flex items-start gap-2 text-xs text-slate-600">
          <span aria-hidden>💡</span> {role}
          {myReviews > 0 && <Link href="/preview/reviews" className="font-medium text-amber-700 hover:underline">{myReviews} waiting for your review →</Link>}
        </p>
      </Card>

      {readyToClose && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-800">🏁 Every {terms.task.one.toLowerCase()} is approved. {canClose ? `You can close this ${terms.project.one.toLowerCase()} now.` : `Waiting for the owner to close it.`}</p>
          {canClose && <Button variant="success" onClick={() => setCloseOpen(true)}>Close {terms.project.one.toLowerCase()}</Button>}
        </div>
      )}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "tasks", label: `${terms.task.many} & ${terms.subtask.many.toLowerCase()}` },
          { key: "board", label: "Board" },
          { key: "timeline", label: "Timeline" },
          { key: "files", label: "Files" },
          { key: "hours", label: "Hours & effort" },
          { key: "activity", label: "Activity" },
          { key: "about", label: "About & team" },
        ]}
      />

      {tab === "tasks" && <ProjectTree project={project} />}
      {tab === "board" && <ProjectBoardView project={project} />}
      {tab === "timeline" && <ProjectTimeline project={project} />}
      {tab === "files" && <ProjectFiles />}
      {tab === "hours" && <ProjectHours project={project} />}
      {tab === "activity" && <ProjectActivity project={project} />}
      {tab === "about" && <ProjectAbout project={project} />}

      <WeightEditor open={weightsOpen} onClose={() => setWeightsOpen(false)} siblings={tasks} parentLabel={project.name} />

      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title={`Close ${terms.project.one.toLowerCase()}?`}>
        <p className="text-sm text-slate-600">
          {readyToClose
            ? `Everything is approved. Closing marks “${project.name}” as finished and moves it out of everyone's active lists.`
            : `Not everything is approved yet (${pct(progress.approved)} complete). You can still close it, for example if the remaining work was dropped.`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCloseOpen(false)}>Cancel</Button>
          <Button
            variant={readyToClose ? "success" : "danger"}
            onClick={() => {
              closeProject(project.id);
              toast(`${project.name} closed`);
              setCloseOpen(false);
            }}
          >
            Close {terms.project.one.toLowerCase()}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function MenuItem({ children, onClick, nc = false }: { children: React.ReactNode; onClick: () => void; nc?: boolean }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
      {children}
      {nc && <NotConnectedTag label="Soon" />}
    </button>
  );
}
