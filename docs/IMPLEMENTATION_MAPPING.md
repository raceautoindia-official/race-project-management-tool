# Redesign → production code: implementation mapping

**Date:** 2026-10-17 · **Branch:** `frontend-redesign`, which includes the merged
`phase-4-5-workflow-calendar-video` production code · **Companion to:** `REDESIGN_PLAN.md`

**Scope (agreed 2026-10-17)**

| | |
|---|---|
| **In** | Project › Task › Subtask; owners, assignees and review; weights; progress roll-up; start/due dates at all three levels; department + designation (with level); the redesigned screens |
| **On hold** | Hours features; multiple companies / super admin / onboarding; anything that changes the Attendance connection (login, role and department sync stay exactly as they are) |
| **Rule** | Nothing existing is dropped. If something can't coexist, ask first. Level names stay Project / Task / Subtask. |

---

## 1. How the redesign maps onto what already exists

| Redesign concept | Already in production | Decision |
|---|---|---|
| Project owner | `projects.owner_id` (always kept as a `lead` in `project_members`) | **Use as is.** The owner gets full manager rights explicitly (not only through the `lead` row). Leads stay as co-managers. |
| Task owner | `tasks.assignee_id`, already labelled "Assigned owner" in the UI | **Use as is.** No new column. |
| Subtask with an assignee | `subtasks` table (checklist rows: title, is_done, position, source) | **Extend the `subtasks` table** (§2). Existing checklist rows become subtasks owned by the task's owner. Spec seeding keeps working. |
| Subtask review by the task owner | — | New: assignee marks it complete → task owner approves or sends back. If the assignee *is* the task owner, it is approved straight away, so today's one-person tasks keep working without extra clicks. |
| Task review by the project owner | Owner "Send for review" → manager marks **Done** | **Keep exactly.** Added: when every subtask is approved, the task moves to review on the server (replacing today's 5-second countdown in the browser). |
| Sign-off | Requester signs off a Done task → permanent lock; project completion needs every task signed off | **Keep unchanged.** It stays the final step after approval. Progress counts at Done; sign-off is still the lock. |
| Weights | — | New `weight` + `weight_mode` on tasks and subtasks. The engine is ported from the approved preview. |
| Progress | Checklist units: each task is worth max(items, 1); ticked items count straight away (`lib/progress.ts`, SQL twin + JS twin + parity test) | **Replace** with the weighted roll-up of approved work: subtask approved → task %; task Done → project %. One server implementation plus one SQL helper; the parity test is rewritten. |
| Start / due dates | Tasks have both; subtasks and projects have neither | Add `start_date` and `due_date` to `projects` and `subtasks`. start ≤ due is enforced. |
| Department | Free-text `users.department` / `projects.department`. Synced from Attendance with an admin override (`department_source`). No table, on purpose (`/api/departments` comment). | **Keep as is.** It touches the Attendance sync, which is on hold. It is shown everywhere people are picked. |
| Designation + level | Free-text `users.designation`, admin-set in PM. No level. | Add a small `designation_levels` table (title → level 1–10), managed in Admin and matched to `users.designation` by name. No change to the Attendance sync. |
| Reviews inbox | `/outstanding` (overdue + in review) | **Reviews** page with tabs *Waiting for me · Overdue · I sent · Recently approved*. `/outstanding` keeps working (it redirects to the Overdue tab). |
| Task page | `TaskDetailModal` (spec, approval trail, sign-off, blockers, time, checklist, files, comments, PDF, .ics, follow-up, save as template) | A full page at `/projects/[id]/tasks/[taskId]` with **every** existing section, plus subtasks at the centre. Old `?task=ID` links (notifications, emails, gallery) redirect to it. |

## 2. Database changes (one idempotent migration, existing style)

`db/migrations/2026-10-17_redesign_fundamentals.sql`, plus the same changes in `db/schema.sql`
(integration tests load only schema.sql) and `migration.test.ts`'s `LATER_MIGRATIONS`.

```
projects   + start_date DATE NULL, + due_date DATE NULL
tasks      + weight DECIMAL(6,3) NOT NULL DEFAULT 0, + weight_mode ENUM('auto','manual') DEFAULT 'auto'
           + position INT NOT NULL DEFAULT 0          -- order in the tree
           (status ENUM unchanged: todo / in_progress / review / done)
subtasks   + description TEXT NULL
           + assignee_id INT NULL → users (SET NULL)  -- backfilled from the task's assignee
           + status ENUM('todo','in_progress','review','done','cancelled') DEFAULT 'todo'
                                                      -- backfilled: is_done=1 → done
           + start_date DATE NULL, + due_date DATE NULL
           + weight DECIMAL(6,3) NOT NULL DEFAULT 0, + weight_mode ENUM('auto','manual') DEFAULT 'auto'
           + submitted_at DATETIME NULL, + approved_by INT NULL → users, + approved_at DATETIME NULL
           + changes_requested VARCHAR(1000) NULL
           + created_by INT NULL → users, + updated_at
           (is_done kept and kept in step with status=done, so nothing reading it breaks)
task_comments    + subtask_id INT NULL → subtasks (CASCADE)   -- discussion on a subtask
task_attachments + subtask_id INT NULL → subtasks (CASCADE)
designation_levels (id, title VARCHAR(120) UNIQUE, level TINYINT, created_at)
```

**Why extend `subtasks` rather than turning subtasks into rows of `tasks`.** Around 30
routes, reports, crons, the calendar feed, the Excel export and the Attendance integration
all read `tasks`. If subtasks became task rows, every one of them would suddenly start
counting subtasks as tasks. A separate table keeps all of them correct with no changes.

**Not touched:** `parent_task_id`/`is_additional` (follow-up work), `request_id`, the sign-off
columns, `approval_status`, `task_dependencies`, `task_requests`, `users.department*`, time logs.

## 3. Navigation (nothing removed; regrouped)

| Group | Items | Notes |
|---|---|---|
| **Work** | My Work *(new home)*, Reviews *(badge)*, Projects, Planner, Calendar | My Work absorbs My Tasks (`/my-tasks` keeps working and redirects). The admin Dashboard content moves to Reports › Overview, and `/dashboard` keeps working. |
| **People** | Team, Work hours | unchanged |
| **Tools** | Meetings, Reminders, Credentials | unchanged |
| **Insight** | Reports *(new; progress only, no hours)* | |
| **Administration** | Admin home, People & levels *(new)*, Activity log, Documents | |

Profile and Notifications stay where they are (avatar menu and bell).

## 4. Project page

- **Header:** owner, department, dates, weighted progress (approved + waiting for review), health
  (progress vs schedule) and the existing actions. Rarely used actions move into a ⋯ menu.
- **Kept as they are:** `ProjectStatusBanner` (approval / completion), `ProjectGallery`,
  `TaskRequestsPanel`, Milestones.
- **Views:**
  - **Tasks** (new default): a tree with inline add, clickable weights and review actions.
  - Board, List (with bulk actions), Timeline, Calendar.
  - About & team (members modal content).
- **Header actions all kept:** New task, Raise request, Export CSV/Excel, Template, Import, Recurring,
  Members, Edit, Save as template.

## 5. Other things that must keep working

- **Attendance app contract.** `/api/integrations/employee-work` is unchanged: it still lists task-level work
  only, because the Attendance connection is on hold.
- **Notifications.** Subtask events add new notification types: assigned, submitted, approved,
  changes requested.
- **Crons.** Due-date alerts will also cover subtasks with due dates (new `subtask_due_*` types).
  Existing behaviour is unchanged.
- **Excel.** The task sheet is unchanged (round-trip test). A second "Subtasks" sheet is added to the
  export. Import of subtasks comes later.
- **Templates.** Project and task templates will also carry subtask titles. Old templates without
  them still work.
- **Tests.** Unit and integration tests are updated where behaviour deliberately changes
  (progress, checklist → subtasks). e2e selectors are updated wherever names change.
- **Two existing bugs found during the survey.** Both are left for you to decide:
  - `project-attachments/[id]` passes a project id where a role is expected, so leads can't
    delete others' gallery files.
  - `/api/tasks/[id]/approval` can never succeed, because nothing sets `approval_status='pending'`.

## 6. Waves (revised)

| Wave | Content |
|---|---|
| 1 | Migration + schema.sql + backfill + before/after progress report on `pm_app_dev` |
| 2 | `lib/work-engine.ts` (weights, roll-up, reviewers, auto-review) + `lib/permissions.ts` + unit tests |
| 3 | APIs: subtasks (assign, dates, review actions), weights, project dates, designation levels; progress everywhere switched to the engine; integration tests |
| 4 | Screens: new shell/nav, My Work, Reviews, Projects list + wizard, Project page tree, Task page, Team pickers, Admin › People & levels, Reports (progress) |
| 5 | Notifications, crons, Excel export, templates, deep-link redirects |
| 6 | Full browser walkthrough per role, e2e update, lint + build, deployment checklist |
