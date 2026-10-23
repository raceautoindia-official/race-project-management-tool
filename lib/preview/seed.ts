// Sample data for the frontend preview. Dates are generated relative to today so
// the demo always looks current (some work overdue, some due soon, etc.).

import { addDays, format } from "date-fns";
import type {
  PreviewState,
  WorkItem,
  StatusCategory,
  Priority,
  Terminology,
  ProjectTemplate,
  Comment,
  ActivityEntry,
  Notification,
  TimeLog,
} from "./types";

export const PREVIEW_VERSION = 5;

const d = (offset: number) => format(addDays(new Date(), offset), "yyyy-MM-dd");
const ts = (offsetDays: number, hour = 10) => {
  const x = addDays(new Date(), offsetDays);
  x.setHours(hour, 15, 0, 0);
  return x.toISOString();
};

export const TERMINOLOGY_PRESETS: { industry: string; terms: Terminology }[] = [
  {
    industry: "General / Corporate",
    terms: {
      project: { one: "Project", many: "Projects" },
      task: { one: "Task", many: "Tasks" },
      subtask: { one: "Subtask", many: "Subtasks" },
    },
  },
  {
    industry: "Manufacturing",
    terms: {
      project: { one: "Order", many: "Orders" },
      task: { one: "Work Order", many: "Work Orders" },
      subtask: { one: "Operation", many: "Operations" },
    },
  },
  {
    industry: "Construction",
    terms: {
      project: { one: "Site", many: "Sites" },
      task: { one: "Work Package", many: "Work Packages" },
      subtask: { one: "Activity", many: "Activities" },
    },
  },
  {
    industry: "Agency / Marketing",
    terms: {
      project: { one: "Campaign", many: "Campaigns" },
      task: { one: "Deliverable", many: "Deliverables" },
      subtask: { one: "Asset", many: "Assets" },
    },
  },
  {
    industry: "Legal / Consulting",
    terms: {
      project: { one: "Matter", many: "Matters" },
      task: { one: "Workstream", many: "Workstreams" },
      subtask: { one: "Action", many: "Actions" },
    },
  },
  {
    industry: "Software",
    terms: {
      project: { one: "Project", many: "Projects" },
      task: { one: "Story", many: "Stories" },
      subtask: { one: "Sub-task", many: "Sub-tasks" },
    },
  },
];

const TEMPLATES: ProjectTemplate[] = [
  {
    id: "tpl-web",
    name: "Website launch",
    industry: "Marketing / Software",
    description: "Plan, build and launch a website with content and QA.",
    tasks: [
      { title: "Discovery & sitemap", subtasks: ["Stakeholder interviews", "Sitemap draft", "Sign-off"] },
      { title: "Design", subtasks: ["Wireframes", "Visual design", "Design review"] },
      { title: "Build", subtasks: ["Page templates", "CMS setup", "Forms & integrations"] },
      { title: "Launch", subtasks: ["QA pass", "Go-live checklist", "Announce"] },
    ],
  },
  {
    id: "tpl-close",
    name: "Monthly accounts close",
    industry: "Finance",
    description: "Standard month-end close with reconciliations and review.",
    tasks: [
      { title: "Reconciliations", subtasks: ["Bank reconciliation", "Vendor ledger", "Customer ledger"] },
      { title: "Accruals & provisions", subtasks: ["Expense accruals", "Provision review"] },
      { title: "Reporting", subtasks: ["Trial balance", "MIS pack", "Management review"] },
    ],
  },
  {
    id: "tpl-install",
    name: "Equipment installation",
    industry: "Manufacturing / Construction",
    description: "Site prep, installation, commissioning and handover.",
    tasks: [
      { title: "Site preparation", subtasks: ["Civil works", "Power & utilities", "Safety audit"] },
      { title: "Installation", subtasks: ["Unloading & placement", "Mechanical fit-up", "Electrical hook-up"] },
      { title: "Commissioning", subtasks: ["Trial run", "Performance test", "Operator training"] },
      { title: "Handover", subtasks: ["Documentation", "Sign-off"] },
    ],
  },
  {
    id: "tpl-onboard",
    name: "Employee onboarding",
    industry: "HR",
    description: "Everything a new joiner needs in their first month.",
    tasks: [
      { title: "Before day one", subtasks: ["Offer paperwork", "Laptop & accounts", "Buddy assigned"] },
      { title: "First week", subtasks: ["Induction session", "Policy walkthrough", "Team intro"] },
      { title: "First month", subtasks: ["30-day check-in", "Goals agreed"] },
    ],
  },
  {
    id: "tpl-campaign",
    name: "Marketing campaign",
    industry: "Agency / Marketing",
    description: "Brief to launch for a multi-channel campaign.",
    tasks: [
      { title: "Brief & strategy", subtasks: ["Creative brief", "Channel plan", "Budget approval"] },
      { title: "Creative production", subtasks: ["Key visual", "Copy", "Video edit"] },
      { title: "Launch & report", subtasks: ["Go live", "Week-1 report"] },
    ],
  },
];

type SubSpec = [title: string, assignee: string | null, status: StatusCategory, extra?: Partial<WorkItem>];

export function buildSeed(): PreviewState {
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const items: WorkItem[] = [];
  const comments: Comment[] = [];
  const activity: ActivityEntry[] = [];
  const timeLogs: TimeLog[] = [];
  const loggedOverride = new Map<string, number>();

  function base(projectId: string, parentId: string | null, title: string, personId: string | null, status: StatusCategory, position: number): WorkItem {
    return {
      id: id(parentId ? "s" : "t"),
      projectId,
      parentId,
      title,
      description: "",
      personId,
      status,
      priority: "medium",
      startDate: null,
      dueDate: null,
      weight: 0,
      weightMode: "auto",
      estimatedHours: null,
      position,
      changesRequested: null,
      submittedAt: status === "in_review" ? ts(-1) : null,
      approvedAt: status === "done" ? ts(-3) : null,
      approvedBy: null,
      createdAt: ts(-20),
    };
  }

  function task(
    projectId: string,
    title: string,
    ownerId: string,
    status: StatusCategory,
    opts: { due: number; start?: number; priority?: Priority; weight?: number; desc?: string; est?: number; logged?: number },
    subs: SubSpec[] = []
  ): WorkItem {
    const pos = items.filter((i) => i.projectId === projectId && !i.parentId).length;
    const t = base(projectId, null, title, ownerId, status, pos);
    t.dueDate = d(opts.due);
    t.startDate = d(opts.start ?? opts.due - 14);
    t.priority = opts.priority ?? "medium";
    t.description = opts.desc ?? "";
    // Expected hours: the task's budget (subtasks split it), or a default for leaf tasks.
    t.estimatedHours = opts.est ?? (subs.length ? null : 12);
    if (opts.logged !== undefined) loggedOverride.set(t.id, opts.logged);
    if (opts.weight !== undefined) {
      t.weight = opts.weight;
      t.weightMode = "manual";
    }
    items.push(t);
    subs.forEach(([st, who, sstatus, extra], i) => {
      const s = base(projectId, t.id, st, who, sstatus, i);
      s.dueDate = d(opts.due - (subs.length - i) * 2);
      s.startDate = d(opts.due - (subs.length - i) * 2 - 4);
      s.estimatedHours = opts.est ? Math.round(opts.est / subs.length) : 8 + ((i * 5) % 9);
      Object.assign(s, extra ?? {});
      items.push(s);
    });
    return t;
  }

  // ── Projects ────────────────────────────────────────────────────────────
  // p1 Website relaunch — owner Priya (default persona)
  task("p1", "Discovery & sitemap", "u-sana", "done", { due: -16, start: -30, weight: 15, desc: "Stakeholder interviews and the new site structure." }, [
    ["Stakeholder interviews", "u-sana", "done"],
    ["Sitemap draft", "u-kavya", "done"],
  ]);
  const web1 = task("p1", "Design system", "u-arun", "in_progress", { due: 6, start: -28, priority: "high", weight: 25, desc: "Colours, type and reusable components the whole site is built from.", est: 60, logged: 41 }, [
    ["Colour tokens", "u-meera", "done"],
    ["Type scale", "u-meera", "done"],
    ["Component library", "u-ravi", "in_review"],
    ["Icon set", "u-meera", "in_progress"],
  ]);
  const web2 = task("p1", "Content migration", "u-sana", "in_progress", { due: 20, start: -10, weight: 25, desc: "Move and rewrite content from the old site.", est: 80, logged: 22 }, [
    ["Content audit", "u-sana", "done"],
    ["Rewrite product pages", "u-kavya", "in_progress", { changesRequested: "Please shorten the intro paragraphs — max 3 lines each." }],
    ["Blog import", "u-priya", "not_started"],
    ["Redirect map", null, "not_started"],
  ]);
  task("p1", "SEO setup", "u-kavya", "in_review", { due: -1, start: -15, weight: 10, desc: "Metadata, sitemap and analytics." , est: 16, logged: 15 });
  task("p1", "QA & launch", "u-arun", "not_started", { due: 40, start: 25, weight: 25, priority: "high" }, [
    ["Cross-browser testing", "u-ravi", "not_started"],
    ["Performance check", "u-ravi", "not_started"],
    ["Go-live checklist", "u-arun", "not_started"],
  ]);
  // Cancelled work drops out of the weighting entirely.
  task("p1", "Printed brochure", "u-priya", "cancelled", { due: -12, start: -30, desc: "Dropped — the client moved to digital-only." });

  // p2 ERP rollout — owner Rahul
  task("p2", "Requirements & fit-gap", "u-rahul", "done", { due: -20, start: -50 }, [
    ["Process workshops", "u-deepak", "done"],
    ["Fit-gap document", "u-deepak", "done"],
  ]);
  task("p2", "Data migration", "u-deepak", "in_progress", { due: 10, start: -15, priority: "high", est: 120, logged: 70 }, [
    ["Customer master", "u-deepak", "done"],
    ["Vendor master", "u-neha", "in_review"],
    ["Item master", "u-vikram", "in_progress"],
    ["Opening balances", "u-neha", "not_started"],
  ]);
  task("p2", "User training", "u-anjali", "not_started", { due: 35, start: 15 }, [
    ["Training calendar", "u-anjali", "not_started"],
    ["Finance team session", "u-neha", "not_started"],
    ["Stores team session", "u-vikram", "not_started"],
  ]);
  task("p2", "Go-live & hypercare", "u-rahul", "not_started", { due: 60, start: 36 });

  // p3 Quarterly close — owner Neha, nearly done
  task("p3", "Bank reconciliations", "u-neha", "done", { due: -6, start: -14 }, [
    ["HDFC current a/c", "u-pooja", "done"],
    ["ICICI current a/c", "u-pooja", "done"],
  ]);
  task("p3", "Accruals & provisions", "u-pooja", "done", { due: -3, start: -10 });
  task("p3", "MIS pack", "u-neha", "in_review", { due: 2, start: -5 }, [
    ["P&L by business unit", "u-pooja", "done"],
    ["Cash-flow statement", "u-pooja", "done"],
  ]);

  // p4 Plant equipment — owner Vikram, behind schedule
  task("p4", "Site preparation", "u-vikram", "done", { due: -25, start: -45 }, [
    ["Civil works", "u-karan", "done"],
    ["Power & utilities", "u-karan", "done"],
  ]);
  task("p4", "Installation", "u-karan", "in_progress", { due: -4, start: -24, priority: "urgent", est: 200, logged: 180 }, [
    ["Unloading & placement", "u-karan", "done"],
    ["Mechanical fit-up", "u-karan", "in_progress"],
    ["Electrical hook-up", "u-deepak", "not_started"],
  ]);
  task("p4", "Commissioning", "u-vikram", "not_started", { due: 12, start: -2 }, [
    ["Trial run", "u-karan", "not_started"],
    ["Operator training", "u-anjali", "not_started"],
  ]);
  task("p4", "Handover documents", "u-vikram", "not_started", { due: 20, start: 10 });

  // p5 Onboarding — planned, starts next week
  task("p5", "Before day one", "u-anjali", "not_started", { due: 8, start: 3 }, [
    ["Offer paperwork", "u-anjali", "not_started"],
    ["Laptops & accounts", "u-deepak", "not_started"],
  ]);
  task("p5", "Induction week", "u-anjali", "not_started", { due: 15, start: 9 });

  // Man-hours: turn each leaf's status into realistic time entries, split into
  // chunks of up to 4h on past working days (Mon–Sat).
  const factors = [0.85, 1.1, 0.95, 1.3, 1.0, 0.9, 1.2];
  items.forEach((it, idx) => {
    const isLeaf = !!it.parentId || !items.some((x) => x.parentId === it.id);
    if (!isLeaf || !it.personId || !it.estimatedHours) return;
    const est = it.estimatedHours;
    let total = loggedOverride.get(it.id) ?? (
      it.status === "done" ? est * factors[idx % factors.length]
      : it.status === "in_review" ? est * 0.95
      : it.status === "in_progress" ? est * 0.45
      : 0);
    total = Math.round(total * 2) / 2;
    const endOffset = Math.min(-1, it.dueDate ? Math.round((new Date(it.dueDate).getTime() - Date.now()) / 86400000) : -1);
    let day = endOffset;
    while (total > 0) {
      const dt = addDays(new Date(), day);
      if (dt.getDay() !== 0) {
        const h = Math.min(total, 2 + ((idx + day) % 3));
        timeLogs.push({ id: id("tl"), itemId: it.id, personId: it.personId, date: format(dt, "yyyy-MM-dd"), hours: h, note: "" });
        total -= h;
      }
      day -= 1;
    }
  });

  // Comments + activity
  const c = (itemId: string, authorId: string, body: string, ago: number, kind: Comment["kind"] = "comment") =>
    comments.push({ id: id("c"), itemId, authorId, body, createdAt: ts(-ago, 11), kind });
  c(web1.id, "u-priya", "Let's keep the palette to 2 brand colours plus neutrals.", 9);
  c(web1.id, "u-arun", "Agreed — tokens are done, Ravi is finishing the component library.", 8);
  c(web2.id, "u-sana", "Redirect map still needs an owner. Can someone from SEO pick it up?", 2);

  const a = (projectId: string, actorId: string, text: string, ago: number, itemId: string | null = null) =>
    activity.push({ id: id("a"), projectId, itemId, actorId, text, createdAt: ts(-ago, 9 + (ago % 8)) });
  a("p1", "u-ravi", "submitted “Component library” for review", 0.2, null);
  a("p1", "u-kavya", "submitted “SEO setup” for review", 1);
  a("p1", "u-sana", "requested changes on “Rewrite product pages”", 1.5);
  a("p1", "u-arun", "approved “Type scale”", 3);
  a("p1", "u-priya", "set weights: Discovery 15%, Design system 25%, Content migration 25%, SEO setup 10%, QA & launch 25%", 6);
  a("p2", "u-neha", "submitted “Vendor master” for review", 0.5);
  a("p3", "u-neha", "all MIS pack items approved — task sent to project owner", 1);
  a("p4", "u-karan", "logged 6h on “Mechanical fit-up”", 0.3);

  const notifications: Notification[] = [
    { id: id("n"), personId: "u-priya", text: "Kavya submitted “SEO setup” for your review", href: "/preview/reviews", read: false, createdAt: ts(-1) },
    { id: id("n"), personId: "u-priya", text: "“Blog import” in Content migration was assigned to you", href: "/preview/projects/p1", read: false, createdAt: ts(-2) },
    { id: id("n"), personId: "u-priya", text: "Website Relaunch is 12 points behind schedule", href: "/preview/projects/p1", read: true, createdAt: ts(-3) },
    { id: id("n"), personId: "u-arun", text: "Ravi submitted “Component library” for your review", href: "/preview/reviews", read: false, createdAt: ts(-0.2) },
    { id: id("n"), personId: "u-kavya", text: "Sana requested changes on “Rewrite product pages”", href: "/preview/my-work", read: false, createdAt: ts(-1.5) },
  ];

  return {
    version: PREVIEW_VERSION,
    currentUserId: "u-priya",
    org: {
      companyName: "Demo Company Pvt. Ltd.",
      industry: "General / Corporate",
      terminology: TERMINOLOGY_PRESETS[0].terms,
      statusLabels: {
        not_started: "Not started",
        in_progress: "In progress",
        in_review: "Waiting for review",
        done: "Done",
        cancelled: "Cancelled",
      },
      progressMode: "approved_tasks",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5, 6],
      timezone: "Asia/Kolkata (IST)",
      country: "India",
    },
    departments: [
      { id: "d-mgmt", name: "Management", color: "slate" },
      { id: "d-mkt", name: "Marketing", color: "pink" },
      { id: "d-eng", name: "Engineering & IT", color: "blue" },
      { id: "d-ops", name: "Operations", color: "orange" },
      { id: "d-fin", name: "Finance", color: "green" },
      { id: "d-hr", name: "Human Resources", color: "purple" },
    ],
    designations: [
      { id: "g-1", name: "Trainee", level: 1 },
      { id: "g-2", name: "Executive", level: 2 },
      { id: "g-3", name: "Senior Executive", level: 3 },
      { id: "g-4", name: "Assistant Manager", level: 4 },
      { id: "g-5", name: "Manager", level: 5 },
      { id: "g-6", name: "Senior Manager", level: 6 },
      { id: "g-7", name: "General Manager", level: 7 },
      { id: "g-8", name: "Director", level: 8 },
    ],
    people: [
      { id: "u-sanjay", name: "Sanjay Kumar", email: "sanjay@demo.co", departmentId: "d-mgmt", designationId: "g-8", isAdmin: true },
      { id: "u-priya", name: "Priya Nair", email: "priya@demo.co", departmentId: "d-mkt", designationId: "g-5", isAdmin: false },
      { id: "u-arun", name: "Arun Prakash", email: "arun@demo.co", departmentId: "d-eng", designationId: "g-4", isAdmin: false },
      { id: "u-meera", name: "Meera Iyer", email: "meera@demo.co", departmentId: "d-eng", designationId: "g-2", isAdmin: false },
      { id: "u-ravi", name: "Ravi Shankar", email: "ravi@demo.co", departmentId: "d-eng", designationId: "g-3", isAdmin: false },
      { id: "u-sana", name: "Sana Sheikh", email: "sana@demo.co", departmentId: "d-mkt", designationId: "g-4", isAdmin: false },
      { id: "u-kavya", name: "Kavya Reddy", email: "kavya@demo.co", departmentId: "d-mkt", designationId: "g-2", isAdmin: false },
      { id: "u-rahul", name: "Rahul Mehta", email: "rahul@demo.co", departmentId: "d-mgmt", designationId: "g-7", isAdmin: false },
      { id: "u-deepak", name: "Deepak Verma", email: "deepak@demo.co", departmentId: "d-eng", designationId: "g-5", isAdmin: false },
      { id: "u-neha", name: "Neha Gupta", email: "neha@demo.co", departmentId: "d-fin", designationId: "g-6", isAdmin: false },
      { id: "u-pooja", name: "Pooja Desai", email: "pooja@demo.co", departmentId: "d-fin", designationId: "g-2", isAdmin: false },
      { id: "u-vikram", name: "Vikram Singh", email: "vikram@demo.co", departmentId: "d-ops", designationId: "g-6", isAdmin: false },
      { id: "u-karan", name: "Karan Patel", email: "karan@demo.co", departmentId: "d-ops", designationId: "g-3", isAdmin: false },
      { id: "u-anjali", name: "Anjali Rao", email: "anjali@demo.co", departmentId: "d-hr", designationId: "g-5", isAdmin: false },
      { id: "u-tina", name: "Tina George", email: "tina@demo.co", departmentId: "d-hr", designationId: "g-1", isAdmin: false },
    ],
    projects: [
      {
        id: "p1", name: "Website Relaunch", description: "Redesign and relaunch the company website with refreshed content and better SEO.",
        ownerId: "u-priya", departmentId: "d-mkt", startDate: d(-30), dueDate: d(45), expectedHours: 420, state: "active",
        memberIds: ["u-arun", "u-meera", "u-ravi", "u-sana", "u-kavya"], createdAt: ts(-31),
        customFields: { cf1: "Internal", cf2: "850000" },
      },
      {
        id: "p2", name: "ERP Rollout — Phase 1", description: "Move finance, purchase and stores onto the new ERP.",
        ownerId: "u-rahul", departmentId: "d-mgmt", startDate: d(-50), dueDate: d(60), expectedHours: 900, state: "active",
        memberIds: ["u-deepak", "u-neha", "u-vikram", "u-anjali", "u-priya"], createdAt: ts(-51),
        customFields: { cf1: "Internal", cf2: "4200000" },
      },
      {
        id: "p3", name: "Q3 Financial Close", description: "Quarter-end close, reconciliations and MIS for the board.",
        ownerId: "u-neha", departmentId: "d-fin", startDate: d(-14), dueDate: d(4), expectedHours: 120, state: "active",
        memberIds: ["u-pooja"], createdAt: ts(-15), customFields: { cf1: "Board" },
      },
      {
        id: "p4", name: "Plant 2 — Press Line Installation", description: "Install and commission the new 400T press line at Plant 2.",
        ownerId: "u-vikram", departmentId: "d-ops", startDate: d(-45), dueDate: d(20), expectedHours: 650, state: "active",
        memberIds: ["u-karan", "u-deepak", "u-anjali"], createdAt: ts(-46),
        customFields: { cf1: "Plant 2", cf2: "12500000" },
      },
      {
        id: "p5", name: "Onboarding — November Batch", description: "Onboard the 6 graduate engineers joining next month.",
        ownerId: "u-anjali", departmentId: "d-hr", startDate: d(3), dueDate: d(33), expectedHours: 60, state: "planned",
        memberIds: ["u-deepak", "u-tina"], createdAt: ts(-2), customFields: {},
      },
    ],
    items,
    comments,
    activity,
    notifications,
    meetings: [
      { id: "m1", title: "Website weekly sync", projectId: "p1", date: d(1), time: "11:00", location: "Conference room B", attendeeIds: ["u-priya", "u-arun", "u-sana", "u-kavya"] },
      { id: "m2", title: "ERP data migration review", projectId: "p2", date: d(3), time: "15:30", location: "Google Meet", attendeeIds: ["u-rahul", "u-deepak", "u-neha", "u-priya"] },
      { id: "m3", title: "Press line safety walk-through", projectId: "p4", date: d(0), time: "16:00", location: "Plant 2", attendeeIds: ["u-vikram", "u-karan"] },
      { id: "m4", title: "Monthly management review", projectId: null, date: d(8), time: "10:00", location: "Board room", attendeeIds: ["u-sanjay", "u-rahul", "u-priya", "u-neha", "u-vikram", "u-anjali"] },
    ],
    reminders: [
      { id: "r1", personId: "u-priya", title: "Renew domain & SSL", date: d(5), time: "09:30", category: "Renewal" },
      { id: "r2", personId: "u-priya", title: "Pay agency invoice #2231", date: d(2), time: "12:00", category: "Payment" },
      { id: "r3", personId: "u-neha", title: "GST filing", date: d(6), time: "10:00", category: "Compliance" },
    ],
    customFields: [
      { id: "cf1", entity: "project", label: "Client / Cost centre", type: "text", options: [], required: false },
      { id: "cf2", entity: "project", label: "Budget (₹)", type: "number", options: [], required: false },
      { id: "cf3", entity: "task", label: "Site / Location", type: "select", options: ["Head office", "Plant 1", "Plant 2", "Remote"], required: false },
    ],
    templates: TEMPLATES,
    timeLogs,
    platformAdmins: [
      { id: "u-super", name: "Asha Menon", email: "asha@platform.example", departmentId: null, designationId: null, isAdmin: true, isSuperAdmin: true },
    ],
    companies: [
      { id: "co-demo", name: "Demo Company Pvt. Ltd.", industry: "General / Corporate", country: "India", plan: "Business", status: "active", seats: 25, users: 15, activeProjects: 4, hoursThisMonth: 1240, adminName: "Sanjay Kumar", adminEmail: "sanjay@demo.co", createdAt: d(-120), lastActiveAt: ts(0), isDemoTenant: true },
      { id: "co-sunrise", name: "Sunrise Constructions", industry: "Construction", country: "India", plan: "Enterprise", status: "active", seats: 100, users: 64, activeProjects: 11, hoursThisMonth: 8650, adminName: "Ramesh Iyer", adminEmail: "ramesh@sunrise.example", createdAt: d(-300), lastActiveAt: ts(-0.1) },
      { id: "co-kaveri", name: "Kaveri Auto Components", industry: "Manufacturing", country: "India", plan: "Enterprise", status: "active", seats: 250, users: 212, activeProjects: 27, hoursThisMonth: 21400, adminName: "Lakshmi Rao", adminEmail: "lakshmi@kaveri.example", createdAt: d(-210), lastActiveAt: ts(-0.05) },
      { id: "co-pixel", name: "Pixel & Pine Agency", industry: "Agency / Marketing", country: "UAE", plan: "Starter", status: "trial", seats: 10, users: 7, activeProjects: 5, hoursThisMonth: 310, adminName: "Omar Haddad", adminEmail: "omar@pixelpine.example", createdAt: d(-9), lastActiveAt: ts(-1) },
      { id: "co-lex", name: "Lexpoint Legal LLP", industry: "Legal / Consulting", country: "India", plan: "Business", status: "suspended", seats: 30, users: 22, activeProjects: 0, hoursThisMonth: 0, adminName: "Farah Khan", adminEmail: "farah@lexpoint.example", createdAt: d(-400), lastActiveAt: ts(-45) },
      { id: "co-green", name: "GreenLeaf Foods", industry: "Manufacturing", country: "India", plan: "Business", status: "onboarding", seats: 40, users: 1, activeProjects: 0, hoursThisMonth: 0, adminName: "Vivek Nair", adminEmail: "vivek@greenleaf.example", createdAt: d(-1), lastActiveAt: ts(-1) },
    ],
  };
}
