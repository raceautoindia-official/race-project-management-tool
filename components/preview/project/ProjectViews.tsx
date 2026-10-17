"use client";

// Secondary project tabs: Board, Timeline, Files, Activity, About & team.

import Link from "next/link";
import { useState } from "react";
import { differenceInCalendarDays, parseISO, addDays, format } from "date-fns";
import Avatar from "@/components/Avatar";
import { useToast } from "@/components/ToastProvider";
import { usePreview } from "@/lib/preview/store";
import {
  can,
  itemLink,
  personById,
  subtasksOf,
  taskProgress,
  tasksOf,
  todayISO,
  hoursSummary,
  hrs,
} from "@/lib/preview/engine";
import type { Project, StatusCategory, WorkItem } from "@/lib/preview/types";
import {
  Button,
  Card,
  DeptBadge,
  DueLabel,
  EmptyState,
  Field,
  NotConnectedTag,
  PersonChip,
  PersonSelect,
  ProgressBar,
  SectionTitle,
  StatusPill,
  inputCls,
  timeAgo,
  useNotConnected,
  usePersonMeta,
} from "../ui";
import { WorkActions } from "../work";
import { EffortVerdict } from "../ItemPanels";

// ── Board ──────────────────────────────────────────────────────────────────

const COLUMNS: StatusCategory[] = ["not_started", "in_progress", "in_review", "done"];

export function ProjectBoardView({ project }: { project: Project }) {
  const { state, terms, statusLabel } = usePreview();
  const [level, setLevel] = useState<"tasks" | "subtasks">("subtasks");
  const items =
    level === "tasks"
      ? tasksOf(state, project.id)
      : tasksOf(state, project.id).flatMap((t) => {
          const subs = subtasksOf(state, t.id);
          return subs.length ? subs : [t];
        });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
          <button onClick={() => setLevel("subtasks")} className={`rounded-md px-2.5 py-1 ${level === "subtasks" ? "bg-indigo-600 text-white" : "text-slate-600"}`}>{terms.subtask.many}</button>
          <button onClick={() => setLevel("tasks")} className={`rounded-md px-2.5 py-1 ${level === "tasks" ? "bg-indigo-600 text-white" : "text-slate-600"}`}>{terms.task.many}</button>
        </div>
        <p className="text-xs text-slate-500">Use the buttons on each card to move work forward. Finished work always goes to its owner for review.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = items.filter((i) => i.status === col);
          return (
            <div key={col} className="rounded-xl bg-slate-100/80 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <StatusPill status={col} />
                <span className="text-xs text-slate-500">{list.length}</span>
              </div>
              <div className="space-y-2">
                {list.length === 0 && <p className="px-2 py-4 text-center text-xs text-slate-400">No items {statusLabel(col).toLowerCase()}</p>}
                {list.map((i) => (
                  <Card key={i.id} className="p-3">
                    <Link href={itemLink(state, i.id)} className="block text-sm font-medium text-slate-900 hover:text-indigo-700">{i.title}</Link>
                    {i.parentId && <p className="truncate text-xs text-slate-500">in {state.items.find((t) => t.id === i.parentId)?.title}</p>}
                    {!i.parentId && subtasksOf(state, i.id).length > 0 && <ProgressBar value={taskProgress(state, i)} size="sm" className="mt-2" />}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <PersonChip id={i.personId} emptyLabel="Unassigned" />
                      <DueLabel date={i.dueDate} status={i.status} />
                    </div>
                    {i.changesRequested && <p className="mt-1 text-xs text-orange-600">↩ Changes requested</p>}
                    <div className="mt-2"><WorkActions item={i} compact /></div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Timeline ───────────────────────────────────────────────────────────────

export function ProjectTimeline({ project }: { project: Project }) {
  const { state, terms } = usePreview();
  const tasks = tasksOf(state, project.id).filter((t) => t.status !== "cancelled");
  const start = parseISO(project.startDate);
  const end = parseISO(project.dueDate);
  const span = Math.max(1, differenceInCalendarDays(end, start));
  const pos = (date: string) => Math.max(0, Math.min(100, (differenceInCalendarDays(parseISO(date), start) / span) * 100));
  const today = pos(todayISO());
  // Month/week ticks
  const ticks: { label: string; left: number }[] = [];
  const step = span > 90 ? 30 : span > 40 ? 14 : 7;
  for (let d = 0; d <= span; d += step) ticks.push({ label: format(addDays(start, d), "d MMM"), left: (d / span) * 100 });

  return (
    <Card className="overflow-x-auto p-4">
      <div className="min-w-[720px]">
        <div className="relative mb-2 ml-56 h-5 text-[11px] text-slate-400">
          {ticks.map((t) => <span key={t.label} className="absolute -translate-x-1/2" style={{ left: `${t.left}%` }}>{t.label}</span>)}
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute bottom-0 top-0 ml-56" style={{ left: 0, right: 0 }}>
            <div className="absolute bottom-0 top-0 w-px bg-red-400" style={{ left: `${today}%` }} title="Today" />
          </div>
          {tasks.map((t) => {
            const s = t.startDate ?? project.startDate;
            const e = t.dueDate ?? project.dueDate;
            const left = pos(s);
            const width = Math.max(2, pos(e) - left);
            const prog = taskProgress(state, t);
            return (
              <div key={t.id} className="flex items-center py-1.5">
                <div className="w-56 shrink-0 pr-3">
                  <Link href={itemLink(state, t.id)} className="block truncate text-sm text-slate-800 hover:text-indigo-700">{t.title}</Link>
                  <p className="truncate text-xs text-slate-500">{personById(state, t.personId)?.name ?? "No owner"}</p>
                </div>
                <div className="relative h-7 flex-1 rounded bg-slate-50">
                  <div className="absolute top-1 h-5 overflow-hidden rounded bg-indigo-100 ring-1 ring-inset ring-indigo-200" style={{ left: `${left}%`, width: `${width}%` }} title={`${s} → ${e}`}>
                    <div className={`h-full ${t.status === "done" ? "bg-green-400" : "bg-indigo-400"}`} style={{ width: `${prog.approved}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Bars run from each {terms.task.one.toLowerCase()}&apos;s start date to its due date; the fill shows approved progress. The red line is today. Drag-to-reschedule <NotConnectedTag />
        </p>
      </div>
    </Card>
  );
}

// ── Files ──────────────────────────────────────────────────────────────────

export function ProjectFiles() {
  const nc = useNotConnected();
  const files = [
    { name: "Brand guidelines v3.pdf", size: "4.2 MB", by: "u-priya", when: "3d ago" },
    { name: "Sitemap.xlsx", size: "86 KB", by: "u-sana", when: "1w ago" },
    { name: "Homepage wireframe.png", size: "1.1 MB", by: "u-arun", when: "2w ago" },
  ];
  return (
    <Card className="p-4">
      <SectionTitle action={<Button size="sm" onClick={nc("Uploading files")}>⬆ Upload</Button>}>
        Files <NotConnectedTag label="Uploads not connected yet" />
      </SectionTitle>
      <p className="mb-3 text-sm text-slate-500">All files attached anywhere in this project — on the project itself, or on any task or subtask — appear here together.</p>
      <ul className="divide-y divide-slate-100">
        {files.map((f) => (
          <li key={f.name} className="flex items-center gap-3 py-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-sm">📄</span>
            <div className="min-w-0 flex-1">
              <button onClick={nc("Downloading files")} className="block truncate text-left text-sm font-medium text-slate-800 hover:text-indigo-700">{f.name}</button>
              <p className="text-xs text-slate-500">{f.size} · {f.when}</p>
            </div>
            <PersonChip id={f.by} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Activity ───────────────────────────────────────────────────────────────

export function ProjectActivity({ project }: { project: Project }) {
  const { state } = usePreview();
  const list = state.activity.filter((a) => a.projectId === project.id);
  if (list.length === 0) return <EmptyState icon="🕘" title="No activity yet" />;
  return (
    <Card className="p-4">
      <ul className="space-y-3">
        {list.map((a) => (
          <li key={a.id} className="flex items-start gap-3 text-sm">
            <Avatar name={personById(state, a.actorId)?.name ?? "?"} size="sm" />
            <p className="flex-1 text-slate-700">
              <strong className="font-medium text-slate-900">{personById(state, a.actorId)?.name}</strong> {a.text}
              <span className="block text-xs text-slate-400">{timeAgo(a.createdAt)}</span>
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── About & team ───────────────────────────────────────────────────────────

export function ProjectAbout({ project }: { project: Project }) {
  const { state, me, terms, updateProject } = usePreview();
  const { toast } = useToast();
  const meta = usePersonMeta();
  const canEdit = can(state, me.id, "project.edit", { project });
  const [form, setForm] = useState({
    name: project.name,
    description: project.description,
    ownerId: project.ownerId as string | null,
    departmentId: project.departmentId,
    startDate: project.startDate,
    dueDate: project.dueDate,
    expectedHours: project.expectedHours?.toString() ?? "",
    custom: { ...project.customFields },
  });
  const [addId, setAddId] = useState<string | null>(null);
  const fields = state.customFields.filter((f) => f.entity === "project");
  const P = terms.project.one.toLowerCase();

  const roleOf = (id: string) => {
    const tasksOwned = tasksOf(state, project.id).filter((t) => t.personId === id).length;
    const subs = state.items.filter((i) => i.projectId === project.id && i.parentId && i.personId === id && i.status !== "done" && i.status !== "cancelled").length;
    return { tasksOwned, subs };
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-4 sm:p-5">
        <SectionTitle>Details</SectionTitle>
        {!canEdit && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Only the {P} owner or an admin can edit these details.</p>}
        <fieldset disabled={!canEdit} className="space-y-3">
          <Field label="Name"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Description"><textarea rows={3} className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label={`${terms.project.one} owner`} hint="Changing the owner hands over approvals and weights to that person.">
            <PersonSelect value={form.ownerId} onChange={(v) => setForm({ ...form, ownerId: v })} allowEmpty={false} />
          </Field>
          <Field label="Department">
            <select className={inputCls} value={form.departmentId ?? ""} onChange={(e) => setForm({ ...form, departmentId: e.target.value || null })}>
              <option value="">Cross-department</option>
              {state.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="Due date"><input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          </div>
          <Field label="Expected working hours" hint="The man-hour budget for the whole job. Leave empty to use what the tasks add up to.">
            <input type="number" min={0} className={inputCls} value={form.expectedHours} onChange={(e) => setForm({ ...form, expectedHours: e.target.value })} />
          </Field>
          {fields.length > 0 && (
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Custom fields</p>
              {fields.map((f) => (
                <Field key={f.id} label={f.label}>
                  {f.type === "select" ? (
                    <select className={inputCls} value={form.custom[f.id] ?? ""} onChange={(e) => setForm({ ...form, custom: { ...form.custom, [f.id]: e.target.value } })}>
                      <option value="">—</option>
                      {f.options.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} className={inputCls} value={form.custom[f.id] ?? ""} onChange={(e) => setForm({ ...form, custom: { ...form.custom, [f.id]: e.target.value } })} />
                  )}
                </Field>
              ))}
            </div>
          )}
          {canEdit && (
            <div className="flex justify-end pt-1">
              <Button
                onClick={() => {
                  updateProject(project.id, {
                    name: form.name.trim() || project.name,
                    description: form.description,
                    ownerId: form.ownerId ?? project.ownerId,
                    departmentId: form.departmentId,
                    startDate: form.startDate,
                    dueDate: form.dueDate,
                    expectedHours: form.expectedHours ? Number(form.expectedHours) : null,
                    customFields: form.custom,
                  });
                  toast("Details saved");
                }}
              >
                Save details
              </Button>
            </div>
          )}
        </fieldset>
      </Card>

      <Card className="p-4 sm:p-5">
        <SectionTitle count={project.memberIds.length + 1}>Team</SectionTitle>
        <ul className="divide-y divide-slate-100">
          {[project.ownerId, ...project.memberIds].map((id) => {
            const r = roleOf(id);
            const owner = id === project.ownerId;
            return (
              <li key={id} className="flex items-center gap-3 py-2.5">
                <PersonChip id={id} size="md" showSubtitle />
                <div className="ml-auto flex items-center gap-2 text-right text-xs text-slate-500">
                  <span>
                    {owner && <span className="mr-1 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">{terms.project.one} owner</span>}
                    {r.tasksOwned > 0 && <span className="block">owns {r.tasksOwned} {terms.task.many.toLowerCase()}</span>}
                    {r.subs > 0 && <span className="block">{r.subs} open {terms.subtask.many.toLowerCase()}</span>}
                  </span>
                  {canEdit && !owner && (
                    <button
                      onClick={() => {
                        updateProject(project.id, { memberIds: project.memberIds.filter((m) => m !== id) });
                        toast(`${meta(id)?.person.name} removed from the team`, "info");
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove from team"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {canEdit && (
          <div className="mt-3 flex gap-2">
            <PersonSelect
              value={addId}
              onChange={setAddId}
              emptyLabel="Add someone to the team…"
              restrictTo={state.people.filter((p) => p.id !== project.ownerId && !project.memberIds.includes(p.id)).map((p) => p.id)}
            />
            <Button
              variant="secondary"
              disabled={!addId}
              onClick={() => {
                if (!addId) return;
                updateProject(project.id, { memberIds: [...project.memberIds, addId] });
                toast(`${meta(addId)?.person.name} added to the team`);
                setAddId(null);
              }}
            >
              Add
            </Button>
          </div>
        )}
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p className="mb-1 font-semibold text-slate-700">Who can do what here</p>
          <ul className="space-y-0.5">
            <li>• <strong>{terms.project.one} owner</strong> adds {terms.task.many.toLowerCase()}, sets their weights and approves finished {terms.task.many.toLowerCase()}.</li>
            <li>• <strong>{terms.task.one} owners</strong> split their {terms.task.one.toLowerCase()} into {terms.subtask.many.toLowerCase()}, assign people and approve finished {terms.subtask.many.toLowerCase()}.</li>
            <li>• <strong>Assignees</strong> work on their {terms.subtask.many.toLowerCase()}, log time and mark them complete.</li>
            <li>• Everyone on the team can see everything and comment.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}


// ── Hours & effort ─────────────────────────────────────────────────────────

/** Compact planned-vs-actual summary for the project header. */
export function HoursStrip({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const { state, terms } = usePreview();
  const h = hoursSummary(state, { project });
  if (!h.planned && !h.logged) return null;
  const over = h.forecastVariancePct > 5;
  return (
    <button onClick={onOpen} className="mt-3 grid w-full grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-left sm:grid-cols-4" title="Open Hours & effort">
      <Stat label="Expected hours" value={h.planned ? hrs(h.planned) : "—"} hint={project.expectedHours != null && Math.abs(h.allocated - h.planned) > 0.5 ? `${hrs(h.allocated)} planned in ${terms.task.many.toLowerCase()}` : "budget for the whole job"} />
      <Stat label="Man-hours logged" value={hrs(h.logged)} hint={h.planned ? `${Math.round(h.usedPct)}% of expected` : undefined} />
      <Stat label="Earned (approved work)" value={hrs(h.earned)} hint={h.efficiency !== null ? `efficiency ${Math.round(h.efficiency)}%` : "nothing approved yet"} />
      <Stat label="Forecast at finish" value={h.planned ? hrs(h.forecast) : "—"} hint={h.planned ? `${h.forecastVariancePct >= 0 ? "+" : ""}${Math.round(h.forecastVariancePct)}% vs expected` : undefined} tone={over ? "red" : "green"} />
    </button>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "red" | "green" }) {
  return (
    <div className="bg-white px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className={`text-xs ${tone === "red" ? "text-red-600" : tone === "green" ? "text-green-700" : "text-slate-500"}`}>{hint}</p>}
    </div>
  );
}

/** Planned vs actual man-hours by task, by person and by department. */
export function ProjectHours({ project }: { project: Project }) {
  const { state, terms } = usePreview();
  const nc = useNotConnected();
  const h = hoursSummary(state, { project });
  const tasks = tasksOf(state, project.id).filter((t) => t.status !== "cancelled");
  const rows = tasks.map((t) => ({ t, s: hoursSummary(state, { item: t }) }));
  const maxHours = Math.max(1, ...rows.map((r) => Math.max(r.s.planned, r.s.logged)));

  // Department roll-up from the people who logged the hours.
  const byDept = new Map<string, number>();
  for (const p of h.people) {
    const dept = personById(state, p.personId)?.departmentId ?? "none";
    byDept.set(dept, (byDept.get(dept) ?? 0) + p.hours);
  }
  const deptRows = [...byDept.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <Card className="p-4 sm:p-5">
        <SectionTitle action={<Button size="sm" variant="secondary" onClick={nc("Exporting timesheets")}>⬇ Export timesheet</Button>}>
          Expected vs actual by {terms.task.one.toLowerCase()}
        </SectionTitle>
        <p className="mb-4 text-sm text-slate-500">
          Expected hours are planned when work is created. Man-hours are what people actually logged. When an item is approved, its final
          man-hours are compared with the estimate.
        </p>
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-slate-300" /> Expected</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-indigo-500" /> Logged</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-red-500" /> Logged over expected</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">{terms.task.one}</th>
                <th className="w-[38%] py-2 pr-3 font-medium">Hours</th>
                <th className="py-2 pr-3 text-right font-medium">Expected</th>
                <th className="py-2 pr-3 text-right font-medium">Logged</th>
                <th className="py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ t, s }) => {
                const over = s.planned > 0 && s.logged > s.planned * 1.05;
                return (
                  <tr key={t.id}>
                    <td className="py-2.5 pr-3">
                      <Link href={itemLink(state, t.id)} className="font-medium text-slate-800 hover:text-indigo-700">{t.title}</Link>
                      <p className="text-xs text-slate-500">{personById(state, t.personId)?.name ?? "No owner"}</p>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="space-y-1" title={`Expected ${hrs(s.planned)} · logged ${hrs(s.logged)}`}>
                        <div className="h-2 rounded-r bg-slate-300" style={{ width: `${(s.planned / maxHours) * 100}%` }} />
                        <div className={`h-2 rounded-r ${over ? "bg-red-500" : "bg-indigo-500"}`} style={{ width: `${(s.logged / maxHours) * 100}%` }} />
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{s.planned ? hrs(s.planned) : "—"}</td>
                    <td className={`py-2.5 pr-3 text-right tabular-nums ${over ? "font-medium text-red-600" : "text-slate-800"}`}>{hrs(s.logged)}</td>
                    <td className="py-2.5">
                      {t.status === "done" ? <EffortVerdict planned={s.planned} actual={s.logged} /> : s.planned ? <span className="text-xs text-slate-500">{Math.round(s.usedPct)}% used · {StatusText(t.status)}</span> : <span className="text-xs text-slate-400">No estimate</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-medium">
                <td className="py-2.5 pr-3 text-slate-800">Total</td>
                <td />
                <td className="py-2.5 pr-3 text-right tabular-nums">{hrs(h.allocated)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{hrs(h.logged)}</td>
                <td className="py-2.5 text-xs text-slate-500">{project.expectedHours != null ? `${terms.project.one} budget ${hrs(project.expectedHours)}` : ""}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <SectionTitle count={h.people.length}>Man-hours by person</SectionTitle>
          {h.people.length === 0 ? <p className="text-sm text-slate-500">No time logged yet.</p> : (
            <ul className="space-y-2.5">
              {h.people.map((p) => (
                <li key={p.personId} className="flex items-center gap-3">
                  <span className="w-44 shrink-0"><PersonChip id={p.personId} showSubtitle /></span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" title={`${hrs(p.hours)} · ${Math.round((p.hours / h.logged) * 100)}% of all hours`}>
                    <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${(p.hours / h.people[0].hours) * 100}%` }} />
                  </span>
                  <span className="w-12 text-right text-sm tabular-nums text-slate-700">{hrs(p.hours)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4 sm:p-5">
          <SectionTitle>Man-hours by department</SectionTitle>
          {deptRows.length === 0 ? <p className="text-sm text-slate-500">No time logged yet.</p> : (
            <ul className="space-y-2.5">
              {deptRows.map(([deptId, hours]) => (
                <li key={deptId} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate">{deptId === "none" ? <span className="text-xs text-slate-500">No department</span> : <DeptBadge id={deptId} />}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" title={`${hrs(hours)} · ${Math.round((hours / h.logged) * 100)}%`}>
                    <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${(hours / deptRows[0][1]) * 100}%` }} />
                  </span>
                  <span className="w-12 text-right text-sm tabular-nums text-slate-700">{hrs(hours)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <p><strong>Earned hours</strong> = the expected hours of work that has been approved ({hrs(h.earned)}).</p>
            <p className="mt-1"><strong>Efficiency</strong> = earned ÷ man-hours actually spent on that work{h.efficiency !== null ? ` (${Math.round(h.efficiency)}%: ${h.efficiency >= 100 ? "faster than estimated" : "slower than estimated"})` : ""}.</p>
            <p className="mt-1"><strong>Forecast</strong> = hours logged so far + the remaining expected work at the current efficiency ({hrs(h.forecast)}).</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatusText(s: StatusCategory): string {
  return s === "in_review" ? "in review" : s === "not_started" ? "not started" : s.replace("_", " ");
}

export type { WorkItem };
