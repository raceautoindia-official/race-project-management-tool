"use client";

// Projects list — every project with its owner, department, progress and
// health at a glance. `?new=1&template=<id>` opens the wizard (used by Admin ›
// Templates).

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Avatar from "@/components/Avatar";
import { usePreview } from "@/lib/preview/store";
import { projectHealth, projectProgress, reviewQueue, tasksOf, isOverdue, personById } from "@/lib/preview/engine";
import type { Project, ProjectState } from "@/lib/preview/types";
import {
  Button,
  Card,
  DeptBadge,
  DueLabel,
  EmptyState,
  HealthBadge,
  PageHeader,
  PersonChip,
  ProgressBar,
  ProgressLegend,
  fmtDate,
  inputCls,
} from "@/components/preview/ui";
import NewProjectWizard from "@/components/preview/NewProjectWizard";

type Scope = "all" | "owned" | "member";

const STATE_LABEL: Record<ProjectState, string> = {
  planned: "Planned",
  active: "Active",
  on_hold: "On hold",
  closed: "Closed",
};

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsView />
    </Suspense>
  );
}

function ProjectsView() {
  const { state, me, terms } = usePreview();
  const params = useSearchParams();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("all");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState<"open" | ProjectState | "">("open");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [wizardOpen, setWizardOpen] = useState(false);

  const fromLink = params.get("new") === "1";
  const closeWizard = () => {
    setWizardOpen(false);
    if (fromLink) router.replace("/preview/projects");
  };

  const visible = state.projects.filter((p) => {
    if (scope === "owned" && p.ownerId !== me.id) return false;
    if (scope === "member" && p.ownerId !== me.id && !p.memberIds.includes(me.id)) return false;
    if (dept && p.departmentId !== dept) return false;
    if (status === "open" && p.state === "closed") return false;
    if (status && status !== "open" && p.state !== status) return false;
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        title={terms.project.many}
        subtitle={`Each ${terms.project.one.toLowerCase()} has one owner who is accountable for it. Progress only counts approved work.`}
        actions={<Button onClick={() => setWizardOpen(true)}>+ New {terms.project.one.toLowerCase()}</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {([
            ["all", "All"],
            ["owned", "I own"],
            ["member", "I'm involved"],
          ] as [Scope, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setScope(k)} className={`rounded-md px-3 py-1.5 ${scope === k ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" className={`${inputCls} sm:max-w-xs`} />
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={`${inputCls} w-auto`} aria-label="Department">
            <option value="">All departments</option>
            {state.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={`${inputCls} w-auto`} aria-label="Status">
            <option value="open">Open (not closed)</option>
            <option value="">Any status</option>
            {Object.entries(STATE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {(["cards", "table"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 capitalize ${view === v ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{v}</button>
          ))}
        </div>
      </div>

      <div className="mb-4"><ProgressLegend /></div>

      {visible.length === 0 ? (
        <EmptyState
          icon="📁"
          title={`No ${terms.project.many.toLowerCase()} match`}
          body="Try clearing the filters, or create a new one."
          action={<Button onClick={() => setWizardOpen(true)}>+ New {terms.project.one.toLowerCase()}</Button>}
        />
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      ) : (
        <ProjectTable projects={visible} />
      )}

      <NewProjectWizard open={wizardOpen || fromLink} onClose={closeWizard} initialTemplate={params.get("template")} />
    </div>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  const { state, terms } = usePreview();
  const h = projectHealth(state, p);
  const tasks = tasksOf(state, p.id).filter((t) => t.status !== "cancelled");
  const done = tasks.filter((t) => t.status === "done").length;
  const pending = reviewQueue(state, p.ownerId).filter((i) => i.projectId === p.id).length;
  const overdue = state.items.filter((i) => i.projectId === p.id && isOverdue(i)).length;
  return (
    <Link href={`/preview/projects/${p.id}`} className="group">
      <Card className="flex h-full flex-col p-4 transition group-hover:border-indigo-300 group-hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-slate-900 group-hover:text-indigo-700">{p.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <DeptBadge id={p.departmentId} />
              <span className="text-xs text-slate-500">{STATE_LABEL[p.state]}</span>
            </div>
          </div>
          <HealthBadge health={h.health} expected={h.expected} />
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-slate-500">{p.description}</p>
        <ProgressBar value={projectProgress(state, p)} showLabel size="lg" className="mt-4" />
        <p className="mt-1 text-xs text-slate-500">
          {done}/{tasks.length} {terms.task.many.toLowerCase()} approved
          {pending > 0 && <span className="text-amber-700"> · {pending} waiting for review</span>}
          {overdue > 0 && <span className="text-red-600"> · {overdue} overdue</span>}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3 mt-4">
          <PersonChip id={p.ownerId} showSubtitle />
          <div className="text-right">
            <div className="flex -space-x-1.5 justify-end">
              {p.memberIds.slice(0, 4).map((m) => (
                <span key={m} className="rounded-full ring-2 ring-white"><Avatar name={personById(state, m)?.name ?? "?"} size="sm" /></span>
              ))}
              {p.memberIds.length > 4 && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-medium text-slate-600 ring-2 ring-white">+{p.memberIds.length - 4}</span>}
            </div>
            <p className="mt-1 text-xs text-slate-500">Due <DueLabel date={p.dueDate} /></p>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ProjectTable({ projects }: { projects: Project[] }) {
  const { state, terms } = usePreview();
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">{terms.project.one}</th>
            <th className="px-4 py-2.5 font-medium">Owner</th>
            <th className="px-4 py-2.5 font-medium">Department</th>
            <th className="w-48 px-4 py-2.5 font-medium">Progress</th>
            <th className="px-4 py-2.5 font-medium">Health</th>
            <th className="px-4 py-2.5 font-medium">Dates</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {projects.map((p) => {
            const h = projectHealth(state, p);
            return (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3"><Link href={`/preview/projects/${p.id}`} className="font-medium text-slate-900 hover:text-indigo-700">{p.name}</Link></td>
                <td className="px-4 py-3"><PersonChip id={p.ownerId} /></td>
                <td className="px-4 py-3"><DeptBadge id={p.departmentId} /></td>
                <td className="px-4 py-3"><ProgressBar value={projectProgress(state, p)} showLabel /></td>
                <td className="px-4 py-3"><HealthBadge health={h.health} expected={h.expected} /></td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(p.startDate)} → {fmtDate(p.dueDate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
