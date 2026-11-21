# Handover — where the PM app stands (21 Nov 2026)

For whoever picks this up next, person or AI session. It records what was built in
October–November 2026, how the pieces fit, how to run and ship it, the working rules the
owner has set, and what is still open. The README describes each feature for users; this
is the map for developers.

## 1. State of the code

- Branch `frontend-redesign` = `origin/frontend-redesign`; all of it is merged into `main`
  (PR #9, `17e9e9b`). Nothing is uncommitted.
- Latest commits, newest first:

  | Commit | What |
  |---|---|
  | `cecee34` | Routine recurring copies stay open the day they finish; lock overnight |
  | `560aead` | Recurring tasks rebuilt (rules, approval, WorkLens calendar); Ongoing projects |
  | `e518b99` | Work timer tied to the Attendance clock; Working on panel in My Work |
  | `1efbb32` | Scripts: staff-sync preview; smoke test for admins |
  | `e38ad6a` | Team › Work updates tab (Daily / Weekly) |
  | `3fedec5` | Retire people who leave Attendance |

- Checks at this point: `npm run test:all` 469 passing, `npm run test:e2e` 53 passing,
  `tsc` and `eslint` clean (one old warning in `public/sw.js`).
- **Not confirmed from here:** whether production has pulled `cecee34`, run every migration,
  and has the WorkLens grants in section 5. Ask before assuming.

## 2. Stack and ground rules of the codebase

- Next.js 16 (route `params` and `searchParams` are Promises; read `AGENTS.md` and
  `node_modules/next/dist/docs/` before writing Next code), React 19, Tailwind v4, mysql2 with
  `dateStrings: true`.
- Times are stored as UTC `YYYY-MM-DD HH:MM:SS` and shown in India time (+05:30). "Today"
  for any rule is the India date.
- The model is **Project › Task › Subtask**. Only approved work moves progress; weights
  decide how much each piece counts (`lib/work-engine.ts`, `lib/progress.ts`).
- Review chain: subtask → task owner approves → task goes to review → a lead marks it Done →
  the requester/admin signs it off → signed-off tasks are read-only → a project completes
  only when every task is signed off.
- **WorkLens** is the Attendance app (worklens.raceinnovations.in). PM reads its database
  read-only through `lib/attendance.ts` (`attendancePool`). Sign-in, roles (admin / member)
  and departments come from it; *lead* is per project, set in a project's Members dialog.
- Many source files use CRLF line endings. Edit them with the Edit tool; shell one-liners
  that rewrite text have twice eaten backslashes in regexes.

## 3. What was built, and where it lives

### Work timer (commit `e518b99`)
- One running timer per person (`work_sessions`, unique `open_user`). Starting needs the
  person clocked in on WorkLens; starting something else switches; clocking out stops the
  timer at the clock-out time.
- Closing a session writes `task_time_logs` with `source = 'timer'`, so every older report
  includes it. Only an admin can delete timer time.
- Code: `lib/attendance-clock.ts` (pure clock rules), `lib/work-sessions.ts`,
  `lib/work-timer.ts` (`startWork`, `pauseWork`, `reconcileTimers`), `lib/time-metrics.ts`
  (pure day metrics), `lib/time-data.ts` (loads a day; `myItemTimes` for My Work).
- API: `app/api/work/timer`, `app/api/tasks/[id]/time`, `app/api/cron/work-timers`.
- UI: `components/work/WorkButton.tsx` (▶ / ⏸ / "Switch to this"), `WorkTimerChip.tsx`
  (header), `WorkingOnPanel.tsx` (My Work), `TimeDayView.tsx` (Work hours › Day),
  `TaskTimeBreakdown.tsx`, shared state in `work-timer-store.ts`.
- `reconcileTimers` runs on the sign-in heartbeat, the chip's 60-second poll, and both cron
  jobs.

### Recurring tasks (commits `560aead`, `cecee34`)
- A **rule** (`recurring_tasks`) = task blueprint + subtasks (`recurring_subtasks`) +
  schedule. Each **copy** is an ordinary task linked by `tasks.recurring_task_id` +
  `occurrence_date` (unique together, so a date is never made twice).
- Anyone on a project proposes; an **admin approves once** and picks the review mode then.
  `review_mode = 'none'` → copies carry `tasks.auto_approve = 1`: marking the work complete
  makes the copy Done at once; it stays open that day (its owner may add a subtask, which
  reopens it) and `lockFinishedRoutineCopies` signs it off after midnight.
- Working days and holidays come from WorkLens (`lib/workdays.ts`): daily copies skip them,
  weekly/monthly ones move to the next working day. No schedule → Monday–Saturday. WorkLens
  unreadable → nothing is skipped.
- While the last copy is open no new one is made (`when_open = 'skip'`, per rule); after
  downtime only the latest copy is made; skips are recorded in `recurring_skips` and shown
  as history dots.
- Copies are weighted 0 (`weight_mode = 'manual'`), so they never move a project's bar. A
  project with rules and **no ordinary task** is **Ongoing**: on-time rate replaces
  "% complete" everywhere (`PROJECT_ONGOING_FIELDS_SQL`, `ongoingOf`, `OngoingSummary`).
- A rule can ask for a project of its own (`new_project_name`); approval creates it.
- Code: `lib/recurrence.ts` (pure schedule maths), `lib/workdays.ts`, `lib/recurring.ts`
  (`createRule`, `updateRule`, `actOnRule`, `runRecurringTasks`, `finishRoutineCopy`,
  `listRules`). API under `app/api/recurring`. UI: `app/recurring/page.tsx`,
  `components/recurring/RecurringView.tsx` and `RecurringForm.tsx`, `RecurringBadge.tsx`.
- `runRecurringTasks` runs inside `/api/cron/work-updates` (every 15 minutes) and
  `/api/cron/recurring`.

### Earlier in the same stretch
- Retired staff sync (`lib/staff-sync.ts`), Work updates with midnight lock, Team › Work
  updates tab, admin Control centre. See the README sections of the same names.

### Fixes of 21 Nov 2026 (not yet committed when written — check `git log`)
- **Sign-off**: one banner, `components/work/SignOffBanner.tsx`, at the top of the task page
  and the task pop-up. A project's owner / lead can now always sign off in their project,
  including a task they own (`canSignOff` in `lib/workflow.ts`); a member still can't sign off
  their own work. "Please sign off" goes to whoever can do it and links to the task page; Needs
  your attention lists every task the viewer can sign off (`lib/my-work.ts`).
- **Project requests**: an admin approving one names the lead (default: whoever asked for it)
  and can add members in the same step (`projectDecisionSchema`, `/api/projects/[id]/decision`,
  `ProjectStatusBanner`). The lead nominated on the request becomes an ordinary member if
  someone else is chosen.
- **Working on**: refreshes when the timer changes anywhere (chip, other tab, clock-out) and
  when work is marked complete; My Work re-reads itself every minute.
- **Timer, never clocked out**: stops at midnight (India) of the day it started, instead of at
  the next clock-in or with nothing credited (`timerStopAt`).
- **Recurring copies need the owner at work**: a daily copy is made once they clock in that
  day (never → skipped as `absent`); a weekly / monthly one on their first day in before the
  next date. `runRecurringFor(userId)` on the sign-in heartbeat makes a held copy as they
  open the app. Migration `2026-11-21_recurring_absent.sql` adds the skip reason.
- **Summaries**: the daily and weekly summaries count subtasks finished (and due), not only
  whole tasks; recurring work is marked ↻ (`lib/daily-summary.ts`, `lib/week-summary.ts`).
- **Calendar**: also shows my subtasks, recurring copies still to come, milestones and
  project deadlines; refreshes itself.
- **Subtasks**: where "+ Add subtask" isn't offered, the panel says why.
- **Needs your attention**: every row names what it is (Task / Subtask / Project) and its
  project.

### Flow changes of 21 Nov 2026 (same uncommitted batch)
- **Roles after the fact**: Members dialog has a Member / Lead dropdown per person
  (`PATCH /api/projects/:id/members`) and **Make owner** for the owner or an admin (the existing
  `PATCH /api/projects/:id { ownerId }`; the old owner stays a lead).
- **Approve & sign off**: a second button beside "Approve task" does both after a
  confirmation (`components/work/TaskActions.tsx`).
- **Five steps on every task** — To do → In progress → In review → Approved → Signed off —
  with who acts next (`components/work/TaskSteps.tsx`). "Approved" is the stored status `done`;
  the status badges still say Done.
- **The pop-up stays** as the quick look; it now carries the steps and "Open full page →".
- **Notifications open the task itself** (`taskLink` in `lib/recipients.ts`); `askForSignOff`
  is the one place that asks for a sign-off, from every way a task becomes Done.
- **Project header**: New task, Recurring, Members, Edit project stay; exports, import,
  template and Save as template are under **More ▾** (a `<details>`; tests open it first).
- **My Work**: "Not started yet" lists only unstarted work (started work is in Working on,
  which now shows due dates); Tasks I own and Projects I own fold away and remember it
  (`components/work/CollapsibleCard.tsx`, localStorage `pm.fold.*`).

## 4. Running and testing

| Need | Command |
|---|---|
| Local sandbox app (port 3100, databases `pm_app_dev` + `attendance_dev`) | `node scripts/dev-sandbox-server.mjs` |
| Unit + integration tests | `npm run test:all` |
| Browser tests (builds first, throwaway database) | `npm run test:e2e` |
| Live smoke test — needs Chrome, so run it from a PC, not the VPS | `SMOKE_URL=… SMOKE_ADMIN=… SMOKE_MEMBER=… SMOKE_PIN=… npm run smoke` |

- Sandbox sign-ins are the test employees in `e2e/users.ts` (`E2EADMIN`, `E2ELEAD`,
  `E2EALICE`, `E2ESAM`, `E2EOLIVIA`); the PIN is in that file. Never use real people's
  credentials for testing.
- The sandbox `attendance_dev` was given WorkLens-like tables by hand (`shifts`,
  `employee_schedules`, `holiday_calendar`, `holiday_observances`, plus `manager_id` and
  `phone` on `employees`). The helper scripts that seeded them (clock in/out, holiday
  calendar, screenshots) lived in a temporary folder and are disposable; rewrite them when
  needed.
- The integration tests stand in for WorkLens with `vi.mock("@/lib/attendance")` (clock
  rows) and `vi.mock("@/lib/workdays")` (calendar).

## 5. Deploying

1. Push `frontend-redesign`, merge into `main` by PR.
2. On the VPS (`~/pm-app`): back up (`mysqldump pm_app`), `git pull`, `npm ci`,
   `npm run build`, stop the app, run any new migration, start the app. Keep the server's
   `.env.local`.
3. Migrations of this stretch, in order — all safe to re-run:
   `2026-10-27_quick_requests`, `2026-10-28_request_attachments`,
   `2026-10-30_update_submission`, `2026-10-31_retired_staff`, `2026-10-31_work_timer`,
   `2026-11-05_recurring_work`. (`cecee34` needs none.)
4. The PM database user needs **SELECT on WorkLens tables**: `attendance` (without it no
   timer can start) and `employee_schedules`, `shifts`, `holiday_calendar`,
   `holiday_observances` (without them holidays and days off are not skipped).
5. Cron: `/api/cron/work-updates` every 15 minutes is required (updates, staff sync, timers,
   recurring copies, overnight lock). `/api/cron/work-timers` every 5 minutes is optional.

## 6. The owner's working rules

- Work against the sandbox (`pm_app_dev`); change production data only with explicit
  approval. Don't change database grants or security settings.
- Don't drop a feature without asking. Keep `/preview`.
- Commit when asked; push and open PRs only when asked.
- Don't repeat credential values in chat; point to `e2e/users.ts`.
- Explain in plain language, with steps the owner can follow on the VPS themselves.

## 7. Open items

Offered and not yet answered — ask before building:
- On-task and idle columns in Work hours › Week (Day has them).
- Making the task page the only task screen (the pop-up was kept: many flows and the
  browser tests open it).
- Renaming the stored status label "Done" to "Approved" everywhere (the steps strip
  already says Approved).

Known limits:
- Recurring: no "first Monday of the month" schedules; the form's date preview ignores
  holidays (the saved rule shows the real date); future copies aren't drawn on the Calendar;
  no per-rule report beyond the on-time count.
- Timer: a clock-out followed quickly by a clock-in can take up to five minutes to stop the
  timer; two tasks can't be timed at once (use "Add time").
- A signed-off copy can't be changed; add the step to the rule for future copies.
- `scripts/flow-test.mjs` was updated for the new Recurring form but not run against a live
  site since.
