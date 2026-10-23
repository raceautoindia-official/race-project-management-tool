"use client";

// In-browser store for the frontend preview. Every action here is a stand-in
// for an API call the backend will provide later; state is kept in
// localStorage so a reviewer can click around and come back to the same demo.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { buildSeed, PREVIEW_VERSION } from "./seed";
import {
  itemById,
  personById,
  projectById,
  reviewerIdFor,
  subtasksOf,
  tasksOf,
} from "./engine";
import type {
  Department,
  Designation,
  Meeting,
  Person,
  PreviewState,
  Project,
  Reminder,
  StatusCategory,
  Terminology,
  WorkItem,
  CustomField,
  Company,
} from "./types";

const STORAGE_KEY = "pm-preview-state";

type Mutator = (draft: PreviewState) => void;

interface NewItemInput {
  title: string;
  personId: string | null;
  dueDate: string | null;
  startDate?: string | null;
  estimatedHours?: number | null;
  priority?: WorkItem["priority"];
  description?: string;
}

interface NewProjectInput {
  name: string;
  description: string;
  ownerId: string;
  departmentId: string | null;
  startDate: string;
  dueDate: string;
  expectedHours: number | null;
  memberIds: string[];
  templateId: string | null;
}

export interface OnboardingResult {
  adminName: string;
  adminEmail: string;
  companyName: string;
  industry: string;
  country: string;
  timezone: string;
  terminology: Terminology;
  workingHoursPerDay: number;
  workingDays: number[];
  departments: string[];
  designations: { name: string; level: number }[];
  invites: { name: string; email: string; department: string; designation: string }[];
}

export interface PreviewApi {
  state: PreviewState;
  me: Person;
  terms: Terminology;
  statusLabel: (s: StatusCategory) => string;
  // session
  switchUser: (id: string) => void;
  resetDemo: () => void;
  // projects
  createProject: (input: NewProjectInput) => string;
  updateProject: (id: string, patch: Partial<Project>) => void;
  closeProject: (id: string) => void;
  // work items
  addTask: (projectId: string, input: NewItemInput) => string;
  addSubtask: (taskId: string, input: NewItemInput) => string;
  updateItem: (id: string, patch: Partial<WorkItem>) => void;
  startWork: (id: string) => void;
  submitForReview: (id: string) => void;
  approve: (id: string) => void;
  requestChanges: (id: string, note: string) => void;
  reopen: (id: string) => void;
  cancelItem: (id: string) => void;
  deleteItem: (id: string) => void;
  setWeights: (entries: { id: string; weight: number; mode: "auto" | "manual" }[]) => void;
  resetWeights: (siblingIds: string[]) => void;
  addComment: (itemId: string, body: string) => void;
  addTimeLog: (itemId: string, entry: { hours: number; date: string; note: string; personId?: string }) => void;
  deleteTimeLog: (id: string) => void;
  // inbox / calendar
  markAllRead: () => void;
  markRead: (id: string) => void;
  addMeeting: (m: Omit<Meeting, "id">) => void;
  addReminder: (r: Omit<Reminder, "id" | "personId">) => void;
  // admin
  updateOrg: (patch: Partial<PreviewState["org"]>) => void;
  updatePerson: (id: string, patch: Partial<Person>) => void;
  addPerson: (p: Omit<Person, "id">) => void;
  upsertDepartment: (d: Department) => void;
  removeDepartment: (id: string) => void;
  upsertDesignation: (g: Designation) => void;
  removeDesignation: (id: string) => void;
  upsertCustomField: (f: CustomField) => void;
  removeCustomField: (id: string) => void;
  // platform (super admin)
  updateCompany: (id: string, patch: Partial<Company>) => void;
  inviteCompany: (c: { name: string; industry: string; country: string; plan: Company["plan"]; seats: number; adminName: string; adminEmail: string }) => void;
  completeOnboarding: (r: OnboardingResult) => void;
}

const PreviewContext = createContext<PreviewApi | null>(null);

export function usePreview(): PreviewApi {
  const ctx = useContext(PreviewContext);
  if (!ctx) throw new Error("usePreview must be used inside <PreviewProvider>");
  return ctx;
}

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(++seq).toString(36)}`;
const nowISO = () => new Date().toISOString();

function loadState(): PreviewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PreviewState;
      if (parsed.version === PREVIEW_VERSION) return parsed;
    }
  } catch {
    // Storage blocked or corrupt — fall back to fresh sample data.
  }
  return buildSeed();
}

// ── Side-effect helpers used inside mutators ───────────────────────────────

function notify(s: PreviewState, personId: string | null, text: string, href: string) {
  if (!personId || personId === s.currentUserId) return;
  s.notifications.unshift({ id: newId("n"), personId, text, href, read: false, createdAt: nowISO() });
}

function log(s: PreviewState, projectId: string, itemId: string | null, text: string) {
  s.activity.unshift({ id: newId("a"), projectId, itemId, actorId: s.currentUserId, text, createdAt: nowISO() });
}

function systemNote(s: PreviewState, itemId: string, body: string) {
  s.comments.push({ id: newId("c"), itemId, authorId: s.currentUserId, body, createdAt: nowISO(), kind: "system" });
}

function itemHref(item: WorkItem): string {
  const taskId = item.parentId ?? item.id;
  return `/preview/projects/${item.projectId}/tasks/${taskId}`;
}

function markStarted(s: PreviewState, item: WorkItem) {
  if (item.parentId) {
    const parent = itemById(s, item.parentId);
    if (parent && parent.status === "not_started") parent.status = "in_progress";
  }
  const project = projectById(s, item.projectId);
  if (project && project.state === "planned") project.state = "active";
}

/**
 * After a subtask changes, decide what its task should be: once every live
 * subtask is approved, the task goes to the project owner for review.
 */
function syncParent(s: PreviewState, taskId: string) {
  const task = itemById(s, taskId);
  if (!task) return;
  const live = subtasksOf(s, taskId).filter((x) => x.status !== "cancelled");
  if (live.length === 0) return;
  const allDone = live.every((x) => x.status === "done");
  if (allDone && task.status !== "done" && task.status !== "in_review") {
    task.status = "in_review";
    task.submittedAt = nowISO();
    const reviewer = reviewerIdFor(s, task);
    systemNote(s, task.id, `All ${live.length} subtasks approved — sent to the project owner for final review.`);
    log(s, task.projectId, task.id, `“${task.title}” is complete and waiting for project-owner review`);
    notify(s, reviewer, `“${task.title}” is ready for your review`, "/preview/reviews");
  } else if (!allDone && (task.status === "in_review" || task.status === "done")) {
    task.status = "in_progress";
    task.approvedAt = null;
    task.submittedAt = null;
  }
}

function seedFromTemplate(s: PreviewState, projectId: string, templateId: string, ownerId: string, start: string, due: string) {
  const tpl = s.templates.find((t) => t.id === templateId);
  if (!tpl) return;
  tpl.tasks.forEach((t, i) => {
    const task = blankItem(projectId, null, t.title, ownerId, i);
    task.startDate = start;
    task.dueDate = due;
    s.items.push(task);
    t.subtasks.forEach((st, j) => s.items.push(blankItem(projectId, task.id, st, null, j)));
  });
}

/**
 * Before adding a sibling: if every existing sibling has a fixed weight, scale
 * them down so the newcomer gets an even share (otherwise it would get 0%).
 */
function makeRoom(siblings: WorkItem[]) {
  const live = siblings.filter((x) => x.status !== "cancelled");
  if (live.length === 0 || !live.every((x) => x.weightMode === "manual")) return;
  const factor = live.length / (live.length + 1);
  for (const x of live) x.weight = Math.round(x.weight * factor * 10) / 10;
}

function blankItem(projectId: string, parentId: string | null, title: string, personId: string | null, position: number): WorkItem {
  return {
    id: newId(parentId ? "s" : "t"),
    projectId,
    parentId,
    title,
    description: "",
    personId,
    status: "not_started",
    priority: "medium",
    startDate: null,
    dueDate: null,
    weight: 0,
    weightMode: "auto",
    estimatedHours: null,
    position,
    changesRequested: null,
    submittedAt: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: nowISO(),
  };
}

// ── Provider ───────────────────────────────────────────────────────────────

export function PreviewProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PreviewState | null>(null);

  useEffect(() => {
    // Client-only: sample data is date-relative and lives in localStorage, so it
    // must load after mount (the server render shows the loading state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadState());
  }, []);

  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore — the demo still works for this session.
    }
  }, [state]);

  const mutate = useCallback((fn: Mutator) => {
    setState((prev) => {
      if (!prev) return prev;
      const draft = structuredClone(prev);
      fn(draft);
      return draft;
    });
  }, []);

  const api = useMemo<PreviewApi | null>(() => {
    if (!state) return null;
    const me = personById(state, state.currentUserId) ?? state.people[0];

    const withItem = (id: string, fn: (s: PreviewState, item: WorkItem) => void) =>
      mutate((s) => {
        const item = itemById(s, id);
        if (item) fn(s, item);
      });

    return {
      state,
      me,
      terms: state.org.terminology,
      statusLabel: (c) => state.org.statusLabels[c],

      switchUser: (id) => mutate((s) => void (s.currentUserId = id)),
      resetDemo: () => {
        const fresh = buildSeed();
        setState(fresh);
      },

      createProject: (input) => {
        const id = newId("p");
        mutate((s) => {
          s.projects.unshift({
            id,
            name: input.name,
            description: input.description,
            ownerId: input.ownerId,
            departmentId: input.departmentId,
            startDate: input.startDate,
            dueDate: input.dueDate,
            expectedHours: input.expectedHours,
            state: "planned",
            memberIds: input.memberIds.filter((m) => m !== input.ownerId),
            createdAt: nowISO(),
            customFields: {},
          });
          if (input.templateId) seedFromTemplate(s, id, input.templateId, input.ownerId, input.startDate, input.dueDate);
          log(s, id, null, `created the ${s.org.terminology.project.one.toLowerCase()}`);
          notify(s, input.ownerId, `You are now the owner of “${input.name}”`, `/preview/projects/${id}`);
        });
        return id;
      },
      updateProject: (id, patch) =>
        mutate((s) => {
          const p = projectById(s, id);
          if (!p) return;
          if (patch.ownerId && patch.ownerId !== p.ownerId) {
            notify(s, patch.ownerId, `You are now the owner of “${p.name}”`, `/preview/projects/${id}`);
            log(s, id, null, `changed the owner to ${personById(s, patch.ownerId)?.name}`);
          }
          Object.assign(p, patch);
        }),
      closeProject: (id) =>
        mutate((s) => {
          const p = projectById(s, id);
          if (!p) return;
          p.state = "closed";
          log(s, id, null, `closed the ${s.org.terminology.project.one.toLowerCase()}`);
        }),

      addTask: (projectId, input) => {
        const id = newId("t");
        mutate((s) => {
          const t = blankItem(projectId, null, input.title, input.personId, tasksOf(s, projectId).length);
          t.id = id;
          t.dueDate = input.dueDate;
          t.startDate = input.startDate ?? null;
          t.estimatedHours = input.estimatedHours ?? null;
          t.priority = input.priority ?? "medium";
          t.description = input.description ?? "";
          makeRoom(tasksOf(s, projectId));
          s.items.push(t);
          log(s, projectId, id, `added ${s.org.terminology.task.one.toLowerCase()} “${t.title}”`);
          notify(s, input.personId, `You own a new ${s.org.terminology.task.one.toLowerCase()}: “${t.title}”`, itemHref(t));
        });
        return id;
      },
      addSubtask: (taskId, input) => {
        const id = newId("s");
        mutate((s) => {
          const task = itemById(s, taskId);
          if (!task) return;
          const st = blankItem(task.projectId, taskId, input.title, input.personId, subtasksOf(s, taskId).length);
          st.id = id;
          st.dueDate = input.dueDate;
          st.startDate = input.startDate ?? null;
          st.estimatedHours = input.estimatedHours ?? null;
          st.priority = input.priority ?? "medium";
          makeRoom(subtasksOf(s, taskId));
          s.items.push(st);
          // A new open subtask re-opens a task that was waiting for sign-off.
          if (task.status === "in_review" || task.status === "done") task.status = "in_progress";
          log(s, task.projectId, id, `added ${s.org.terminology.subtask.one.toLowerCase()} “${st.title}” to “${task.title}”`);
          notify(s, input.personId, `New ${s.org.terminology.subtask.one.toLowerCase()} for you: “${st.title}”`, itemHref(st));
        });
        return id;
      },
      updateItem: (id, patch) =>
        withItem(id, (s, item) => {
          if (patch.personId !== undefined && patch.personId !== item.personId && patch.personId) {
            notify(s, patch.personId, `“${item.title}” was assigned to you`, itemHref(item));
            log(s, item.projectId, item.id, `assigned “${item.title}” to ${personById(s, patch.personId)?.name}`);
          }
          Object.assign(item, patch);
        }),
      startWork: (id) =>
        withItem(id, (s, item) => {
          item.status = "in_progress";
          markStarted(s, item);
          log(s, item.projectId, item.id, `started “${item.title}”`);
        }),
      submitForReview: (id) =>
        withItem(id, (s, item) => {
          const reviewer = reviewerIdFor(s, item);
          item.submittedAt = nowISO();
          item.changesRequested = null;
          markStarted(s, item);
          if (reviewer === s.currentUserId) {
            // The reviewer finishing their own work signs it off directly.
            item.status = "done";
            item.approvedAt = nowISO();
            item.approvedBy = s.currentUserId;
            systemNote(s, item.id, "Completed and self-approved by the reviewer.");
            log(s, item.projectId, item.id, `completed “${item.title}”`);
            if (item.parentId) syncParent(s, item.parentId);
            return;
          }
          item.status = "in_review";
          systemNote(s, item.id, `Submitted for review to ${personById(s, reviewer)?.name ?? "the owner"}.`);
          log(s, item.projectId, item.id, `submitted “${item.title}” for review`);
          notify(s, reviewer, `${personById(s, s.currentUserId)?.name} submitted “${item.title}” for your review`, "/preview/reviews");
        }),
      approve: (id) =>
        withItem(id, (s, item) => {
          item.status = "done";
          item.approvedAt = nowISO();
          item.approvedBy = s.currentUserId;
          item.changesRequested = null;
          systemNote(s, item.id, "Approved — now counts toward progress.");
          log(s, item.projectId, item.id, `approved “${item.title}”`);
          notify(s, item.personId, `“${item.title}” was approved`, itemHref(item));
          if (item.parentId) syncParent(s, item.parentId);
          else {
            const p = projectById(s, item.projectId);
            const live = tasksOf(s, item.projectId).filter((t) => t.status !== "cancelled");
            if (p && live.every((t) => t.status === "done")) {
              notify(s, p.ownerId, `“${p.name}” is ready to close`, `/preview/projects/${p.id}`);
            }
          }
        }),
      requestChanges: (id, note) =>
        withItem(id, (s, item) => {
          item.status = "in_progress";
          item.changesRequested = note;
          item.submittedAt = null;
          s.comments.push({ id: newId("c"), itemId: item.id, authorId: s.currentUserId, body: `Changes requested: ${note}`, createdAt: nowISO(), kind: "system" });
          log(s, item.projectId, item.id, `requested changes on “${item.title}”`);
          notify(s, item.personId, `Changes requested on “${item.title}”`, itemHref(item));
        }),
      reopen: (id) =>
        withItem(id, (s, item) => {
          item.status = "in_progress";
          item.approvedAt = null;
          item.approvedBy = null;
          log(s, item.projectId, item.id, `reopened “${item.title}”`);
          notify(s, item.personId, `“${item.title}” was reopened`, itemHref(item));
          if (item.parentId) syncParent(s, item.parentId);
        }),
      cancelItem: (id) =>
        withItem(id, (s, item) => {
          item.status = "cancelled";
          log(s, item.projectId, item.id, `cancelled “${item.title}”`);
          if (item.parentId) syncParent(s, item.parentId);
        }),
      deleteItem: (id) =>
        mutate((s) => {
          const item = itemById(s, id);
          if (!item) return;
          s.items = s.items.filter((i) => i.id !== id && i.parentId !== id);
          log(s, item.projectId, null, `deleted “${item.title}”`);
          if (item.parentId) syncParent(s, item.parentId);
        }),
      setWeights: (entries) =>
        mutate((s) => {
          let projectId = "";
          for (const e of entries) {
            const item = itemById(s, e.id);
            if (!item) continue;
            item.weight = e.weight;
            item.weightMode = e.mode;
            projectId = item.projectId;
          }
          if (projectId) log(s, projectId, null, "adjusted weights");
        }),
      resetWeights: (ids) =>
        mutate((s) => {
          let projectId = "";
          for (const id of ids) {
            const item = itemById(s, id);
            if (!item) continue;
            item.weightMode = "auto";
            item.weight = 0;
            projectId = item.projectId;
          }
          if (projectId) log(s, projectId, null, "reset weights to an even split");
        }),
      addComment: (itemId, body) =>
        mutate((s) => {
          const item = itemById(s, itemId);
          if (!item) return;
          s.comments.push({ id: newId("c"), itemId, authorId: s.currentUserId, body, createdAt: nowISO(), kind: "comment" });
          notify(s, item.personId, `${personById(s, s.currentUserId)?.name} commented on “${item.title}”`, itemHref(item));
        }),
      addTimeLog: (itemId, entry) =>
        withItem(itemId, (s, item) => {
          const hours = Math.round(entry.hours * 100) / 100;
          s.timeLogs.push({ id: newId("tl"), itemId, personId: entry.personId ?? s.currentUserId, date: entry.date, hours, note: entry.note });
          if (item.status === "not_started") {
            item.status = "in_progress";
            markStarted(s, item);
          }
          log(s, item.projectId, item.id, `logged ${hours}h on “${item.title}”`);
        }),
      deleteTimeLog: (id) => mutate((s) => void (s.timeLogs = s.timeLogs.filter((l) => l.id !== id))),

      markAllRead: () =>
        mutate((s) => {
          for (const n of s.notifications) if (n.personId === s.currentUserId) n.read = true;
        }),
      markRead: (id) =>
        mutate((s) => {
          const n = s.notifications.find((x) => x.id === id);
          if (n) n.read = true;
        }),
      addMeeting: (m) => mutate((s) => void s.meetings.push({ ...m, id: newId("m") })),
      addReminder: (r) => mutate((s) => void s.reminders.push({ ...r, id: newId("r"), personId: s.currentUserId })),

      updateOrg: (patch) => mutate((s) => void Object.assign(s.org, patch)),
      updatePerson: (id, patch) =>
        mutate((s) => {
          const p = personById(s, id);
          if (p) Object.assign(p, patch);
        }),
      addPerson: (p) => mutate((s) => void s.people.push({ ...p, id: newId("u") })),
      upsertDepartment: (dep) =>
        mutate((s) => {
          const i = s.departments.findIndex((x) => x.id === dep.id);
          if (i >= 0) s.departments[i] = dep;
          else s.departments.push(dep);
        }),
      removeDepartment: (id) =>
        mutate((s) => {
          s.departments = s.departments.filter((x) => x.id !== id);
          for (const p of s.people) if (p.departmentId === id) p.departmentId = null;
        }),
      upsertDesignation: (g) =>
        mutate((s) => {
          const i = s.designations.findIndex((x) => x.id === g.id);
          if (i >= 0) s.designations[i] = g;
          else s.designations.push(g);
          s.designations.sort((a, b) => a.level - b.level);
        }),
      removeDesignation: (id) =>
        mutate((s) => {
          s.designations = s.designations.filter((x) => x.id !== id);
          for (const p of s.people) if (p.designationId === id) p.designationId = null;
        }),
      upsertCustomField: (f) =>
        mutate((s) => {
          const i = s.customFields.findIndex((x) => x.id === f.id);
          if (i >= 0) s.customFields[i] = f;
          else s.customFields.push(f);
        }),
      removeCustomField: (id) => mutate((s) => void (s.customFields = s.customFields.filter((x) => x.id !== id))),

      updateCompany: (id, patch) =>
        mutate((s) => {
          const c = s.companies.find((x) => x.id === id);
          if (c) Object.assign(c, patch);
        }),
      inviteCompany: (c) =>
        mutate((s) =>
          void s.companies.unshift({
            ...c,
            id: newId("co"),
            status: "onboarding",
            users: 1,
            activeProjects: 0,
            hoursThisMonth: 0,
            createdAt: nowISO().slice(0, 10),
            lastActiveAt: nowISO(),
          })
        ),
      completeOnboarding: (r) =>
        mutate((s) => {
          // Applies the wizard's choices to the demo tenant so the reviewer lands
          // in a workspace that reflects what they just set up.
          Object.assign(s.org, {
            companyName: r.companyName,
            industry: r.industry,
            country: r.country,
            timezone: r.timezone,
            terminology: r.terminology,
            workingHoursPerDay: r.workingHoursPerDay,
            workingDays: r.workingDays,
          });
          const colors = ["slate", "blue", "green", "orange", "purple", "pink", "teal", "amber", "red", "indigo"];
          for (const name of r.departments) {
            if (!s.departments.some((d) => d.name.toLowerCase() === name.toLowerCase()))
              s.departments.push({ id: newId("d"), name, color: colors[s.departments.length % colors.length] });
          }
          for (const g of r.designations) {
            if (!s.designations.some((x) => x.name.toLowerCase() === g.name.toLowerCase()))
              s.designations.push({ id: newId("g"), name: g.name, level: g.level });
          }
          s.designations.sort((a, b) => a.level - b.level);
          for (const inv of r.invites) {
            s.people.push({
              id: newId("u"),
              name: inv.name,
              email: inv.email,
              departmentId: s.departments.find((d) => d.name === inv.department)?.id ?? null,
              designationId: s.designations.find((g) => g.name === inv.designation)?.id ?? null,
              isAdmin: false,
            });
          }
          const demo = s.companies.find((c) => c.isDemoTenant);
          if (demo) Object.assign(demo, { name: r.companyName, industry: r.industry, country: r.country, adminName: r.adminName, adminEmail: r.adminEmail });
        }),
    };
  }, [state, mutate]);

  if (!api) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading preview…
      </div>
    );
  }
  return <PreviewContext.Provider value={api}>{children}</PreviewContext.Provider>;
}

export { newId };
