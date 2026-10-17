# Deploying the redesign (Project › Task › Subtask)

Branch `frontend-redesign`. It contains the production code (`phase-4-5-workflow-calendar-video`)
plus the redesign. These steps extend **README › Deploying to production**. Follow them in order.

## Before the day

1. **Rehearse on a copy.** Restore a fresh production backup into a scratch database and
   apply the migrations below. Then run:
   ```bash
   node scripts/compare-schemas.mjs <scratch_db>          # must print "IDENTICAL columns and foreign keys"
   node scripts/redesign-progress-report.mjs <scratch_db> # each project's progress: old rule vs new
   ```
   Share the progress report with the people who own those projects (see "What users will
   notice"). Both scripts read connection settings from `.env.local`, and compare-schemas
   refuses to run against the database named there.
2. **A migration production has never run.** When the production copy was compared, it was
   missing `users.department_source`. That column comes from
   `2026-10-13_department_override.sql`, which is in the codebase but was never run on the
   server. It is included in the list below.

## On the day

1. **Back up:** `mysqldump --single-transaction --routines --triggers --hex-blob pm_app > backup.sql`.
   There is no down-migration; rolling back means restoring this file.
2. **Upload source and build.** Follow README steps 2–4 unchanged: no `.env.local` on the
   server; `npm ci`, then `npm run build`. **No new environment variables are needed.**
3. **Stop the old app, then run the migrations in date order.** Every one is safe to re-run,
   so running one that already ran does nothing. Any of the earlier ones (09-17 … 10-13) that
   your server hasn't had, then:
   ```bash
   mysql -u <user> -p pm_app < db/migrations/2026-10-12_department_templates.sql
   mysql -u <user> -p pm_app < db/migrations/2026-10-12_departments.sql
   mysql -u <user> -p pm_app < db/migrations/2026-10-13_department_override.sql   # missing on the production copy
   mysql -u <user> -p pm_app < db/migrations/2026-10-13_designation.sql
   mysql -u <user> -p pm_app < db/migrations/2026-10-13_project_attachments.sql
   mysql -u <user> -p pm_app < db/migrations/2026-10-17_redesign_fundamentals.sql
   ```
   On Windows use `cmd /c "mysql … < db\migrations\<file>"`.

   `2026-10-17_redesign_fundamentals.sql` does the following:
   - Adds subtask assignees, statuses, dates, weights and review fields, plus task weights
     and order, and project dates.
   - Lets comments and files belong to a subtask, and adds the `designation_levels` table.
   - Runs a **one-time** backfill (recorded in `applied_data_fixes`):
     - existing checklist items go to the task's owner;
     - ticked items become approved;
     - projects get start and due dates from their tasks;
     - every job title already in use is listed in Admin, waiting for a level.
4. **Start the new build** (`npm run start`, or however you run it today: pm2, systemd…).
5. **Smoke test** with `npm run smoke` (README step 7). It now opens projects on the Board view
   by itself.
6. **Check by hand** (5 minutes):
   - **My Work** opens after login.
   - **Reviews** shows anything waiting.
   - A project opens on **Tasks & subtasks**; expand a task and you see its subtasks with
     owners, dates and weights.
   - **Open page →** shows the task page.
   - **Admin › People & levels** lists the job titles. Give each a level.

## Rollback

Stop the app. Restore `backup.sql` into `pm_app`. Redeploy the previous build (the commit
before the merge on this branch, or whatever is on the server today).

## What users will notice

- **The home page is My Work**: what needs you, your to-dos, what you own. My Tasks is now
  a tab on it. **Reviews** replaces Outstanding (old links still work).
- **Subtasks are real work items**: each has an assignee, dates and a weight, and the task's
  owner reviews it.
  - The owner's own subtasks are approved as soon as they're marked complete.
  - When every subtask is approved, the task goes for review by itself. "Send for review"
    still works too.
- **Progress counts approved work only, by weight.** A task counts toward its project once
  it's approved (Done). Some projects will show a lower percentage than before; the
  progress report from the rehearsal shows which and why.
- **Members can't add work to an approved task**: ask the project owner or a lead to reopen
  it.
- **Projects have start and due dates**, and an on-track / at-risk / off-track indicator.
- **Owners set weights** by clicking a weight or using **⚖ Adjust weights**. Changing one
  rebalances the others so the total stays 100%.
- The project page remembers which view (Tasks & subtasks, Board, List…) each person used
  last.

## Still on hold (not in this release)

- Hours features: man-hours, timesheets, capacity.
- Multiple companies, super admin and onboarding.
- Any change to the Attendance connection: login, role and department sync are unchanged.
- The `/preview` design prototype is still public, with sample data only. Remove it once the
  redesign is complete, as agreed.
