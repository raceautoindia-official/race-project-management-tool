# PM Tool Redesign — Project › Task › Subtask

**Status:** Proposal · **Date:** 2026-10-15 (revised 2026-10-16) · **Supersedes:** ad-hoc feature waves 1–12

> **Revision 2026-10-16.** Four things are now in scope:
> - One application hosting many companies, managed by a platform super admin (§5.2).
> - A company and account onboarding flow (§6.7).
> - Start dates and expected working hours on projects, tasks and subtasks (§2.4).
> - Man-hour tracking with metrics (§3.6).
>
> The weight editor now rebalances automatically (§3.1). The clickable preview at `/preview`
> shows all of it.

---

## 1. Why we are redesigning

The app has many features (meetings, reminders, recurring tasks, templates, time logs,
approvals, milestones, push, Excel), but they were added one wave at a time. Nothing ties
them together around one simple idea, so the app feels like a set of separate tools.

**The goal:** every feature hangs off one spine:

```
Project  (owned by a Project Owner)
  └── Task      (owned by a Task Owner)
        └── Subtask  (assigned to an Assignee)
```

Progress flows **up** the spine automatically (subtask → task → project). Responsibility
flows **down** it: the project owner hands tasks to task owners, and task owners hand
subtasks to assignees.

### 1.1 What is wrong today (diagnosis)

| # | Problem | Where | Effect |
|---|---------|-------|--------|
| 1 | **Subtasks are only checklist items.** They have no assignee, due date, status, weight, comments or files. | `db/schema.sql` → `subtasks` table (`title`, `is_done`, `position`) | We can't give a subtask to a person, so the 3-level model doesn't exist. |
| 2 | **Three different "progress" formulas.** Task progress uses the checklist ratio, otherwise hours spent ÷ estimate, otherwise a guess from the status (40% / 75%). Project progress counts *done tasks ÷ all tasks* and ignores partial progress. | `lib/progress.ts`, `app/projects/page.tsx:17`, `lib/dashboard.ts:79`, `components/ProjectCard.tsx:7` | The bars don't agree with each other. A task at 90% adds 0% to its project. Logging extra hours makes a task look "done". |
| 3 | **No weights.** Every task counts equally toward the project. | — | A 2-hour task and a 2-month task move the project bar by the same amount. |
| 4 | **Ownership is unclear.** Projects have an `owner_id`, but the permissions check the `lead` role in `project_members`, not the owner. Tasks only have an `assignee_id`, with no separate accountable owner. | `lib/rbac.ts` (`canManageProject`) | It isn't clear who is responsible. The "owner" field doesn't give that person any rights. |
| 5 | **No department or designation (level).** | Not in the PM schema or in `lib/attendance.ts` | We can't filter, assign or report by department, and can't apply level-based rules. |
| 6 | **Hard-coded vocabulary and workflow.** The statuses `todo/in_progress/review/done`, the priorities and the words "Project/Task" are built into enums. | `lib/types.ts`, `db/schema.sql` | Doesn't fit other industries (manufacturing work orders, legal matters, agency campaigns…). |
| 7 | **Single-company assumptions.** Login is a PIN checked against *one* company's attendance DB, and there is no `organization` concept. | `lib/attendance.ts`, `lib/auth.ts` | Can't serve several companies from one install. |
| 8 | **Too much navigation, and features in silos.** There are 9 top-level menu items. Outstanding, Reminders, Meetings and Calendar are separate pages. The project page is an 860-line board with 4 views, milestones and 5 modals. Task detail is a 950-line modal with the checklist buried inside it. | `components/AppShell.tsx`, `components/project/ProjectBoard.tsx`, `components/project/TaskDetailModal.tsx` | There is no obvious "what do I do next?" path. Users have to hunt. |

---

## 2. Target domain model

### 2.1 Roles on the spine

| Level | Accountable person | What they can do |
|-------|--------------------|------------------|
| **Project** | **Project Owner** (exactly one; optional co-managers) | Create/assign tasks, set and **adjust task weights**, approve tasks, close the project |
| **Task** | **Task Owner** (exactly one) | Break the task into subtasks, assign them, **adjust subtask weights**, review subtasks, submit the task |
| **Subtask** | **Assignee** (exactly one) | Do the work: update status, log time, comment, attach files |

If a task has **no subtasks**, the task owner is also the one doing it, so the task itself
is the leaf.

### 2.2 People: department and designation

Each employee has:

- **Department** — e.g. Engineering, Sales, Accounts, Production
- **Designation** — e.g. Executive, Senior Executive, Manager, GM. Each designation has a
  numeric **level** (1 = most junior), so rules and reports can compare seniority across
  differently named titles.

Where they are used:

- **Assignee pickers:** group by department, show the designation under each name, and
  filter by department.
- **Team / workload view:** open subtasks and hours per person, rolled up per department.
- **Reports:** completion, on-time % and overdue counts by department.
- **Optional rules (per org):** e.g. "Project Owner must be level ≥ 3". Default: no rule.

Source of truth: if the attendance DB already has department/designation, **sync it the
same way we sync name/email** (in `provisionPmUser` and `scripts/seed.mjs`). If it doesn't,
manage both lists in PM's Admin. See open question Q1.

### 2.3 One table for tasks and subtasks (recommended)

Instead of upgrading the `subtasks` checklist table, **a subtask becomes a row in `tasks`
with a `parent_id`**:

- `level = 1` → task (`parent_id` is NULL)
- `level = 2` → subtask (`parent_id` = its task)
- The code enforces a maximum depth of 2.

**Why:** comments, attachments, time logs, dependencies, labels, approvals, notifications,
search and export already key off `tasks.id`. With one table, subtasks get every one of
these features at once, instead of us rebuilding each one for a second table.

The existing `tasks.parent_task_id` (used for "additional/follow-up work") is renamed to
`follow_up_of_id` so the two meanings don't clash.

### 2.4 Schema changes (summary)

```sql
-- Platform & tenants (many companies in one application — §5.2)
organizations(id, name, slug, industry, country, timezone, plan, seats,
              status ENUM('onboarding','trial','active','suspended'),
              working_hours_per_day DECIMAL(4,2) DEFAULT 8,
              working_days SET('mon','tue','wed','thu','fri','sat','sun'),
              settings JSON, created_at)
platform_admins(id, name, email, password_hash, mfa_secret, created_at)   -- super admins, not company members
impersonation_log(id, platform_admin_id, org_id, reason, started_at, ended_at)
org_invites(id, org_id, email, role, token_hash, expires_at, accepted_at)

departments(id, org_id, name, is_active)
designations(id, org_id, name, level TINYINT, is_active)
users  + org_id, department_id, designation_id, email, password_hash (org-aware login)

projects
  + org_id
  + owner_id  NOT NULL              -- now the real authority (was decorative)
  + department_id NULL              -- owning department
  + start_date NOT NULL, due_date NOT NULL
  + expected_hours DECIMAL(8,2) NULL -- man-hour budget for the whole project
  + progress_pct DECIMAL(5,2)       -- cached roll-up
  + settings JSON                   -- per-project overrides (approval gates, partial progress)

project_members.role_in_project: ENUM('owner','manager','member','viewer')   -- replaces lead/member

tasks
  + parent_id  NULL  → tasks.id     -- subtask link
  + level      TINYINT (1|2)
  + owner_id   NULL                 -- required for level 1
  ~ assignee_id                     -- required for level 2
  + weight       DECIMAL(6,3)       -- share of parent, in %
  + weight_mode  ENUM('auto','manual') DEFAULT 'auto'
  + progress_pct DECIMAL(5,2)       -- cached
  + manual_pct   DECIMAL(5,2) NULL  -- only if partial progress is enabled
  + status_id → workflow_statuses   -- replaces ENUM (phase D)
  + position INT                    -- ordering among siblings
  ~ start_date, due_date            -- both on tasks AND subtasks; start ≤ due enforced
  ~ estimated_hours → expected_hours -- on tasks AND subtasks
  - spent_hours                     -- replaced by SUM(time_logs.hours)
  ~ parent_task_id → follow_up_of_id

-- Man-hours (extends today's task_time_logs)
time_logs(id, org_id, task_id, user_id, work_date DATE, hours DECIMAL(5,2), note,
          created_at, approved_by NULL, approved_at NULL)   -- one row per person/day/item
timesheet_weeks(id, org_id, user_id, week_start DATE,
                status ENUM('open','submitted','approved','returned'), approver_id)

-- Configurability (phase D)
workflow_statuses(id, org_id, name, color, category ENUM('not_started','in_progress','in_review','done','cancelled'), position)
org_terminology(org_id, key, singular, plural)          -- "Project"→"Job", "Task"→"Work Order"
custom_fields(id, org_id, entity ENUM('project','task','subtask'), key, label, type, options JSON, required)
custom_field_values(field_id, entity_id, value JSON)
```

The old `subtasks` table is migrated into `tasks` and then dropped (see §7).

---

## 3. The progress and weight engine

This is the core of the redesign. There must be **one implementation**, on the server, in
one module (`lib/progress-engine.ts`). Every progress bar in the app reads its cached
result. No component should calculate progress on its own again.

### 3.1 Weights: even by default, adjustable by the owner

Every child (a task inside a project, or a subtask inside a task) has a `weight` (% of its
parent) and a `weight_mode`:

- **auto** (default): it shares whatever is left over equally with the other auto siblings.
- **manual**: the owner has fixed it to a value.

```
manualSum = Σ weight of manual siblings          (must be ≤ 100)
autoShare = (100 − manualSum) / count(auto siblings)
```

- **Add a subtask** → all auto siblings rebalance at once (3 subtasks at 33.3% → 4 at 25%).
  If every sibling is already fixed, they are scaled down proportionally so the newcomer
  still gets an even share. It never gets 0%.
- **Editing in the weight editor (revised after preview feedback):**
  - Changing one item automatically rebalances the others, in proportion to their current
    size, so the total is always exactly 100%. There is no "total must be 100" error and
    Save never blocks.
  - An item you change is locked (🔒) so adjusting the next one doesn't move it. Click the
    lock to release it. If every other item is locked, they all absorb the change.
  - On save, the values are stored as manual weights.
- **"Reset to even split"** → everything goes back to auto.
- **Where to find it:**
  - Every weight value in the project tree and on the task page is a clickable chip.
  - There are "⚖ Adjust weights" buttons on the project header, the task list toolbar,
    under each task's subtasks, and on the task page.
  - People without permission see the value with a tooltip saying only the owner can
    change it.
- **Who can edit:** project owner/managers for task weights, and the task owner (plus the
  project owner) for subtask weights. Every change is written to the activity log.

### 3.2 Leaf progress

A *leaf* is a subtask, or a task with no subtasks.

- **Default (binary):** `done` = 100%, anything else = 0%. This is simple and hard to game.
- **Optional, per project: "allow partial progress"** → the assignee can set 0–100% with a
  slider while working.
- **Cancelled** items are left out of the calculation completely: their weight is 0 and
  their siblings rebalance.
- **Hours no longer drive progress.** Estimated vs spent hours is shown next to the bar as
  effort information, not as completion.

### 3.3 Roll-up

```
task.progress    = Σ(subtask.weight × subtask.progress) / Σ(subtask.weight)   [non-cancelled]
project.progress = Σ(task.weight    × task.progress)    / Σ(task.weight)      [non-cancelled]
```

We divide by `Σ weight` instead of assuming it equals 100. That way rounding (33.333…)
or a bad manual total can never produce 99.9% or 101%.

**Worked example.** A project has Task A (weight 60) and Task B (weight 40).
Task A has 3 even subtasks, and 2 are done. Task B has no subtasks and is in progress
(binary).

| Item | Weight | Progress | Contribution |
|------|--------|----------|--------------|
| A.1 ✓ | 33.3 | 100 | |
| A.2 ✓ | 33.3 | 100 | |
| A.3 | 33.3 | 0 | |
| **Task A** | **60** | **66.7%** | 40.0 |
| **Task B** | **40** | **0%** | 0 |
| **Project** | | **40.0%** | |

When A.3 is ticked: Task A → 100%, and the project → 60%.

### 3.4 When it is recalculated

`recomputeFrom(taskId)` runs **in the same DB transaction** as any change that affects
progress:

- subtask status changes
- a subtask is added or deleted
- weights change
- a subtask moves to another task
- an item is cancelled

It recalculates the parent task, then the project, and writes the cached `progress_pct`.
Lists and dashboards only read the cached columns. They stay fast and always match.

### 3.5 Automatic status changes (the "flow")

| Event | Automatic effect | Who is notified |
|-------|------------------|-----------------|
| Subtask assigned | — | Assignee |
| First subtask moves to *In progress* | Parent task: *Not started → In progress*. Project: *Planned → Active* | — |
| Subtask completed | Task progress updates | Task owner |
| All subtasks done/cancelled | Task → *In review* (if the project needs task approval) or *Done* | Project owner (review) / Task owner |
| Task approved/done | Project progress updates | Task owner, and the project owner if it was auto-done |
| Subtask reopened while its task is *Done* | Task → *In progress* | Task owner and project owner |
| All tasks done | Project shows **"Ready to close"**. It is *not* closed automatically; the owner closes it on purpose. | Project owner |
| Manually marking a task *Done* while subtasks are still open | Blocked. The owner is offered "Complete / cancel remaining subtasks". | — |

The existing approval gate (Wave 7) becomes a **per-project setting** with two switches:
"Task owner reviews subtasks" (default off) and "Project owner approves tasks" (default
on).

---

### 3.6 Dates, expected hours and man-hours

**Dates.** Projects, tasks and subtasks all have a start date and a due date:
- New items default their start date to the parent's.
- Start ≤ due is enforced.
- A child outside its parent's range shows a warning but isn't blocked.
- Items still *Not started* after their start date show "Should have started".

**Expected hours** are planned top-down:

| Level | Set by | Meaning |
|---|---|---|
| Project | Project owner | Man-hour budget for the whole job (optional) |
| Task | Project owner / task owner | Estimate for the task. If empty, it is the sum of its subtasks. |
| Subtask | Task owner | Estimate for the piece of work |

The UI shows both a level's own figure and what the level below adds up to. For example:
"Expected 60h · subtasks planned 48h", or "420h budget · 380h planned in tasks".

**Man-hours** are time-log entries: person, item, date, hours and an optional note.
- They are logged on leaves (subtasks, or tasks without subtasks), either from the item's
  Time panel or from a weekly **Timesheet** grid.
- A task's or project's man-hours are the sum over everything beneath it.
- Hours are **effort**, not progress. Progress still comes only from approvals (§3.2).

**Metrics.** Computed in one place (`lib/hours-engine.ts`, mirroring the preview's
`hoursSummary`):

| Metric | Formula | Shown on |
|---|---|---|
| Expected | as above | project header, tree, task page, drawer |
| Logged (actual) | Σ time_logs | everywhere expected is shown |
| Used % | logged ÷ expected | bars on the tree, task page, project Hours tab |
| Remaining / Over by | expected − logged | task page, drawer |
| Earned hours | Σ expected hours of **approved** leaves | project header, Reports |
| Efficiency | earned ÷ man-hours spent on that approved work (100% = on estimate) | project, task, Reports |
| Forecast at completion | logged + (expected − earned) ÷ efficiency | project header, Reports |
| Final effort verdict | on approval, actual vs expected: on estimate (±5%), x% over, x% under | review card, task page, Hours tab |
| Utilisation | logged ÷ capacity (working days so far × hours per day) | Team, Timesheet, My Work, Reports |
| Booked ahead | Σ expected − logged on a person's open items | Team |
| Estimate accuracy | distribution of actual vs expected on approved items | Reports |

Capacity uses each company's work week (hours per day and working days). This is set
during onboarding and in Admin. Approving timesheets (`timesheet_weeks`) is an optional
company setting.

## 4. Permissions (replaces `lib/rbac.ts` logic)

| Action | Org admin | Project owner / manager | Task owner | Subtask assignee | Member | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| View project | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit project, members, settings | ✓ | ✓ | | | | |
| Create task / set task owner | ✓ | ✓ | | | | |
| Adjust **task** weights | ✓ | ✓ | | | | |
| Edit own task (title, dates, description) | ✓ | ✓ | ✓ | | | |
| Create/assign subtasks | ✓ | ✓ | ✓ | | | |
| Adjust **subtask** weights | ✓ | ✓ | ✓ | | | |
| Update status / log time on a subtask | ✓ | ✓ | ✓ | ✓ (own) | | |
| Approve task (if gated) | ✓ | ✓ | | | | |
| Comment / attach files | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Close / archive project | ✓ | ✓ | | | | |

This is implemented as one function, `can(user, action, item)`, which resolves the
user's role by walking up the item's parents. It replaces the ad-hoc checks spread across
the routes.

---

## 5. Making it work for any company or industry

There are two separate concerns. They have different costs, so we treat them separately.

### 5.1 Configurability (do this — high value, moderate cost)

| Feature | What it gives | Example |
|---|---|---|
| **Terminology** | Rename the three levels per org. The UI reads labels from `org_terminology`. | Construction: *Site › Work Package › Activity*. Agency: *Campaign › Deliverable › Asset*. Legal: *Matter › Workstream › Action*. Manufacturing: *Order › Work Order › Operation*. Software: *Project › Story › Sub-task*. |
| **Custom workflow statuses** | Each org defines its own statuses. Each status maps to one of 5 fixed **categories**, and the engine only looks at the category. | Manufacturing: *Queued → Machining → QC → Dispatched (done)*. |
| **Custom fields** | Extra fields on project/task/subtask: text, number, date, dropdown, person, currency. | Client name, PO number, site location, SKU, case number. |
| **Industry templates** | Starter projects with tasks, subtasks, default weights and custom fields (builds on the Wave-12 templates). | "Website launch", "Monthly close", "New-hire onboarding", "Equipment installation". |
| **Priority, labels, work week, timezone, approval defaults** | Org settings instead of constants. | IST today, from `lib/tz.ts`. |

### 5.2 Multi-tenancy — many companies in one application (✅ in scope, 2026-10-16)

Every company gets its own workspace inside the **same** application. A **platform super
admin** manages all of them.

**Roles**

| Role | Scope | Can |
|---|---|---|
| Platform super admin | Whole platform (not a member of any company) | Create/invite companies, set plan & seats, suspend/reactivate, see usage, enter a company workspace via **audited impersonation** |
| Company admin | One company | People, departments, designations, terminology, statuses, work week, templates, custom fields |
| Project owner / task owner / assignee | One company | As in §4 |

**Isolation (non-negotiable)**
- `org_id` on every company-owned table.
- Every query goes through one data-access layer that injects `org_id` from the session.
  No route builds SQL without it.
- Foreign keys can't cross orgs, which is checked on write.
- Uploads are stored under per-org prefixes.
- Automated isolation tests try to read and write another company's ids.

**Login**
- Org-aware: email + password (or SSO per company), with a company chosen on the login
  page or resolved from the email domain or invite.
- The current attendance-DB PIN login becomes an optional per-company connector: it lets
  Demo Company keep Employee ID + PIN and syncs department and designation (Q1).

**Super-admin console** (`/platform`):
- Overview KPIs.
- Companies table with plan, status, users vs seats, active projects, hours this month and
  last active.
- A company drawer: open workspace (impersonate), change plan, suspend/reactivate, resend
  the admin invite.
- Plans & billing, platform settings (default templates, terminology presets, security
  defaults) and a platform audit log.

**Company lifecycle:** `invited → onboarding → trial/active → suspended`. Suspended
companies are read-only for their admin; only the super admin can reactivate them.

**Billing/payments** stay out of the first release: plans and seats are recorded and
enforced, and invoicing is done manually until a payment provider is chosen.

---

## 6. User experience and flow

### 6.1 Navigation (9 items → 5)

```
My Work      ← home page: "what do I do next?"
Projects
Team         ← people, departments, workload
Calendar     ← due dates + meetings + reminders together
Reports
──────────
Admin        ← people, departments, designations, workflow & terminology, templates, activity log
(avatar menu: Profile, Notifications, Push settings, Log out)
```

**Outstanding** becomes an *Overdue* filter, on My Work and on each project. **Meetings**
and **Reminders** live inside Calendar (with "New meeting" / "New reminder" buttons).

### 6.2 My Work (new home)

Three sections, sorted by urgency:

1. **Needs my action:** subtasks assigned to me (overdue first), tasks waiting for my
   review, tasks I own that are ready to submit, projects ready to close.
2. **Tasks I own:** each with a progress bar, its subtask assignees and the next due date.
3. **Projects I own:** each with a progress bar and **health** (see below).

Each section shows a clear empty state with the next step ("You have no subtasks — browse
projects").

**Health** = actual progress compared with expected progress. Expected progress is the
share of time elapsed between the project's start and due dates. More than 10 points behind
= *At risk*, more than 25 = *Off track*. This one indicator tells an owner more than four
separate charts.

### 6.3 Project page

```
┌──────────────────────────────────────────────────────────────────────┐
│ Website Relaunch          Owner: ● Priya (Mktg · Manager)   ⚙ ⋯     │
│ 12 Oct → 30 Nov · Marketing dept       ███████████░░░░░ 62%  At risk │
├──────────────────────────────────────────────────────────────────────┤
│ [Tasks] Board  Timeline  Files  Activity          Filter ▾  + Task   │
├──────────────────────────────────────────────────────────────────────┤
│ ▾ Design system          ● Arun   25%  ████████░░ 80%   Due 20 Oct  │
│     ✓ Colour tokens       ● Meera  33%   Done                        │
│     ✓ Type scale          ● Meera  33%   Done                        │
│     ○ Component library   ● Ravi   34%   In progress   Due 18 Oct    │
│     + Add subtask                                                    │
│ ▸ Content migration      ● Sana   40%  ███░░░░░░░ 30%   Due 15 Nov  │
│ ▸ QA & launch            ● Arun   35%  ░░░░░░░░░░  0%   Due 30 Nov  │
│ + Add task                                       Adjust weights ⚖    │
└──────────────────────────────────────────────────────────────────────┘
```

- **Default view = an expandable tree** (task rows with their subtasks), because this is
  the spine. Board, Timeline and Calendar are secondary tabs.
- Each row shows **owner/assignee (with department · designation on hover), weight %,
  progress and due date**, so ownership is always visible.
- Inline "+ Add subtask" / "+ Add task": type a title, pick a person, press Enter. Weights
  rebalance immediately.
- Ticking a subtask animates the task bar *and* the project bar, so the user sees the
  roll-up happen.
- Milestones move into Timeline. Recurring tasks, import/export and templates move into
  the ⋯ menu and stop crowding the header.

### 6.4 Task page (replaces the 950-line modal)

This becomes a real URL: `/projects/[id]/tasks/[taskId]`, with the breadcrumb
**Project › Task**. It can be shared, bookmarked and opened from notifications.

- Header: title, owner, status, due date, progress bar, and the "Submit for review" /
  "Approve" button (shown only when it applies).
- **Main area: the subtasks list** (assignee, due, weight, status) with an **Adjust
  weights** panel (sliders, live total, "Reset to even").
- Tabs underneath: Discussion · Files · Time · Dependencies · Activity.
- Clicking a subtask opens a **side drawer** with the same tabs, scoped to that subtask.

### 6.5 Creation flows

1. **New project wizard** (3 short steps): name and description → owner, department and
   dates → start blank or from a template (industry templates appear here).
2. **Add task:** title, owner (picker grouped by department), due date. Weight is auto.
3. **Task owner gets "You own a new task"** → the task page opens with an empty-state
   prompt: "Break this into subtasks or work on it directly."
4. **Assignee gets "New subtask for you"** → it appears at the top of My Work.

### 6.6 Notifications follow the spine

Each event in §3.5 sends **one** notification to the next person up or down the chain. We
also fix the noise: batch "N subtasks completed on Task X" into one notification if they
happen within 10 minutes, and respect a per-user email preference (in-app only /
email / digest).

---

### 6.7 Company & account onboarding (first-time setup)

The super admin creates a company and the company admin receives an invite email. The
first sign-in opens a full-screen, 6-step wizard. Progress is saved, so the admin can stop
and come back.

1. **Create your account:** name, work email, password (or Google/Microsoft sign-in).
2. **Your company:** name, industry, size, country, timezone and the **work week** (hours
   per day and working days, which drive capacity and utilisation).
3. **How you name your work:** the three levels, pre-filled from the industry preset and
   editable, with a live preview such as "Order › Work Order › Operation".
4. **Departments & levels:** suggested by industry and editable; a designation ladder with
   numeric levels.
5. **Invite your team:** rows of name, email, department and designation, or import from
   Excel, or connect an attendance/HR system. This step can be skipped.
6. **You're all set:** a summary, plus an optional first project from an industry
   template. Then the admin lands in My Work with a "Getting started" checklist.

Invited team members get a shorter flow: set a password, confirm profile (department and
designation pre-filled), and a 4-step "how work flows here" intro.

## 7. Data migration (existing production data)

Run as a reversible migration script (with a dry-run mode) in the existing
`db/migrations/` style:

1. Create `organizations` (1 row) and `departments` / `designations`. Backfill
   `org_id = 1` everywhere.
2. Add the new columns to `tasks`. Set `level = 1`. Set `owner_id = COALESCE(assignee_id,
   created_by, project.owner_id)`.
3. **Copy each `subtasks` row into `tasks`:** `level = 2`, `parent_id = task_id`,
   `assignee_id = parent.assignee_id`, status `done`/`todo` from `is_done`, keep
   `position`, `weight_mode = 'auto'`.
4. `project_members`: `lead → manager`. Make sure the project's `owner_id` has an `owner`
   membership. Projects with a NULL owner → the first lead, or the creator.
5. Rename `parent_task_id → follow_up_of_id`.
6. Run `recomputeAll()` to fill every cached `progress_pct`. Write a comparison report
   (old % vs new %) so we can explain any changes to users.
7. Drop `subtasks` only after one release cycle.

---

## 8. Delivery plan

Each phase can ship on its own. These continue the repo's "wave" numbering.

### Phase A — Foundation (data and rules) · Waves 13–14

- Schema from §2.4: organizations + `org_id` everywhere, departments/designations, unified
  hierarchy, owner, weights, cached progress, start dates and expected hours on all three
  levels, `time_logs` with work date.
- Org-scoped data-access layer and isolation tests (multi-tenancy is now in scope, so this
  can't be deferred).
- `lib/hours-engine.ts` with tests: expected/allocated roll-up, logged, earned,
  efficiency, forecast, utilisation.
- `lib/progress-engine.ts` (weights, roll-up, recompute in a transaction) and
  `lib/permissions.ts` (`can()`).
- Department/designation sync (or the admin screens, depending on Q1).
- Migration script from §7.
- **Add a test runner (Vitest)** with unit tests for the engine: even split, manual
  override, all-manual = 100, cancelled items, rounding, empty task, reopening.
- **Done when:** every existing API returns the same data plus the new fields, every
  progress number comes from the engine, and the tests pass.

### Phase B — Core flow and UX · Waves 15–17

- New navigation (§6.1). My Work home (§6.2).
- Project page tree view with inline add, weight editor and roll-up animation (§6.3).
- Task page plus subtask drawer (§6.4). Creation wizard and empty states (§6.5).
- Pickers grouped by department, showing designation.
- **Done when:** a new user can create a project, add 3 tasks with owners, have one owner
  add subtasks, complete them, and watch both bars reach 100%, all without help.
  Test this with 3 real users.

### Phase C — Roll-ups everywhere · Wave 18

- Dashboards, Team (workload by department/designation), Reports, Excel export and the
  weekly digest all read the cached progress and the new roles.
- Notifications follow the spine and are batched (§6.6). Project health indicator.
- Remove the old `lib/progress.ts` formulas and the status-percentage guesses.

### Phase D — Configurability · Waves 19–20

- Terminology, custom workflow statuses (status ENUM → `workflow_statuses` + category),
  custom fields, org settings.
- 4–6 industry templates.

### Phase E — Platform & onboarding · Waves 21–22 (no longer optional)

- Org-aware login (email/password + optional SSO; attendance PIN as a per-company
  connector), invites, and the onboarding wizard (§6.7).
- Super-admin console (§5.2): companies, plans & seats, suspend/reactivate, audited
  impersonation, and the platform audit log.
- Per-org email "from" settings and per-org storage prefixes.
- Timesheet weekly submit and approve (optional per company).
- **Done when:**
  - A new company can be invited, complete onboarding and run a project end to end.
  - Automated tests prove no request can read or write another company's data.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Users see their project % change after migration (the old formula only counted done tasks) | Before/after report (§7 step 6), plus a short in-app banner: "Progress now reflects weighted subtasks". |
| Weight editing confuses people | Auto by default, so most users never touch it. One clear editor with a live total and a reset button. |
| Gaming progress with partial % | Binary by default. Partial progress is opt-in per project and logged. |
| The big UI rewrite stalls | Phase A changes no screens. Phase B replaces one page at a time behind the new navigation, and old pages stay reachable until each replacement is signed off. |
| Cached progress drifts out of date | Recompute runs inside the write transaction. A nightly `recomputeAll` cron reports and fixes any drift. |
| Next.js 16 API differences | Check `node_modules/next/dist/docs/` before each phase (per `AGENTS.md`). |

---

## 10. Open questions (needed before Phase A starts)

1. **Q1 — Does the attendance DB already store department and designation for each
   employee?** If yes, we sync them. If no, PM manages them, or we add them to attendance
   and sync.
2. **Q2 — ✅ Decided (2026-10-16): one shared application hosting many companies, managed
   by a platform super admin**, with a company onboarding flow (§5.2, §6.7). Still open:
   - Which login methods each company needs (email/password, Google/Microsoft SSO,
     attendance PIN)?
   - Do we need per-company subdomains (acme.app.com)?
   - Is a payment provider needed in the first release, or are invoices manual?
7. **Q7 — Timesheets:** should weekly timesheets need approval (by the reporting manager or
   the project owner) before hours count in reports? Recommendation: an optional company
   setting, off by default.
8. **Q8 — Can people log time on behalf of others** (e.g. a site supervisor for a crew)?
   Recommendation: yes for task owners and above, recorded as "logged by X for Y".
3. **Q3 — ✅ Decided (2026-10-15): every completed subtask *and* task must be reviewed by its
   owner before it counts toward progress.** A subtask is reviewed by its task owner; a task
   by its project owner. If the reviewer finishes their own work, it is approved directly.
   By default, project progress counts only approved tasks. An org setting can also count
   approved subtasks inside unfinished tasks. Work waiting for review is shown separately
   (a striped amber bar) and never counts. This replaces the "default off" approval gates
   in §3.5.
4. **Q4 —** merged into Q3.
5. **Q5 — Fixed at 3 levels?** Recommendation: yes. Deeper nesting hurts usability. Use
   the checklist *inside* a subtask's description if needed.
6. **Q6 — Can a task have more than one owner, or a subtask more than one assignee?**
   Recommendation: exactly one each (clear accountability), plus optional "watchers".
