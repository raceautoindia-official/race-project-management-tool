# PM App — Internal Project Management Tool

A full-stack, role-based project management app built with **Next.js 16 (App Router)**,
**React 19**, **MySQL 8**, and a custom JWT session auth. It is an **internal** tool:
there is **no public sign-up** — an admin provisions every account.

## Features

- **Role-based access (admin / member)** enforced **server-side** in the proxy *and* in
  every API route — not just hidden in the UI.
- **Sign-in with the Attendance app**: users log in with their Employee ID + PIN, checked
  against the Attendance database (`attendance.employees`); PMApp stores no passwords and
  mirrors employees into its own `users` table. Signed JWT session in an **httpOnly**
  cookie (via `jose`), proxy route protection, per-client and per-account login
  attempt limits.
- **Projects**: CRUD, membership management (lead/member), progress tracking.
  Members can **create a project** and nominate the lead who approves it; it stays
  read-only until that lead (or an admin) approves.
- **Two kinds of work**: every task is either an **existing work correction** (title,
  existing behavior, expected behavior, acceptance criteria; reason and scope optional)
  or a **new feature** (title, features, rules; flow optional). The person raising a
  request also sets its **priority, estimated hours and a from–to date range** — the approver
  can adjust them, but never has to guess. Leads create tasks
  directly; members **raise task requests** that a lead approves (assigning an owner) or
  rejects with a reason.
- **Approval trail + sign-off lock**: each task records who **requested** it, who
  **approved** it, its **assigned owner** and who **signed it off**. Sign-off (by the
  requester or a lead/admin, once the task is Done) makes the task and everything on it
  — comments, checklist, files, time logs — **permanently read-only**. A project can
  only be marked **Completed** once every task is signed off, and is then read-only
  (an admin can reopen it).
- **Checklist from the spec**: a new task arrives with a checklist built from what
  it was asked for — acceptance criteria and expected behaviour for a correction,
  features and rules for a new feature — so progress is ticked off against the
  request rather than a list someone retypes. A task whose checklist has fallen
  behind its spec (created before this existed, or its spec written afterwards)
  shows **+ From specification** on the checklist; it only ever adds, so nothing
  already ticked is disturbed. To bring every existing task up at once:

  ```bash
  npm run backfill:checklists -- --dry-run   # show what it would add
  npm run backfill:checklists                # add it
  ```
- **Task PDF**: download any task (spec, approval trail, checklist, files, comments) as
  a PDF.
- **Calendar**: meetings arrive as real **calendar invitations** by email, so they appear
  in Google, Outlook or Apple Calendar by themselves — no setting up, and cancelling one
  withdraws it again. A private subscription link adds **task due dates and reminders** on
  top; single entries can be added with one click or downloaded as `.ics`.
- **Video meetings**: scheduling a meeting creates a room in the company meetings app
  (or takes a Zoom/Meet/Teams link you already have), with a **Join** button on the
  meeting, in reminder emails and in the calendar entry.
- **WhatsApp alerts**: notifications can also go to WhatsApp (Meta Cloud API) for people
  who add a number and opt in on their profile.
- **Tasks**: CRUD, assignees, priority, due dates, a 4-column status workflow, a
  **Kanban board** with drag-and-drop, a sortable/filterable **List view**, a
  **Calendar view** by due date, and a task detail panel with a **comments** thread.
- **Labels / tags** (colored, per-project, filterable) and **subtasks / checklists**
  with progress tracking on each task.
- **Global search** (top bar) across the projects and tasks you can access.
- **CSV export** of a project's tasks, plus the user list and activity log (admin).
- **Role-aware dashboards** with charts (recharts), **My Tasks** (list + calendar),
  and a profile page where you can edit your name and change your password.
- **Activity log / audit trail** and basic **in-app notifications**.
- Polished UX: **toast notifications**, **initials avatars**, and a **mobile-responsive**
  collapsible sidebar.
- Every request body is validated with **zod**; all SQL is **parameterized**.

## Stack

| Concern        | Choice                                             |
| -------------- | -------------------------------------------------- |
| Framework      | Next.js 16 (App Router, Turbopack) + React 19 + TS |
| Database       | MySQL 8 via `mysql2/promise` (shared pool)         |
| Auth           | `bcryptjs` + `jose` (HS256 JWT) + httpOnly cookie  |
| Validation     | `zod`                                              |
| Styling        | Tailwind CSS v4                                     |
| Charts / dates | `recharts` + `date-fns`                            |

## Prerequisites

- **Node.js 20 LTS or 22 LTS** recommended. (Other versions may emit `EBADENGINE`
  warnings from transitive deps but still work.)
- **MySQL 8** — either via Docker (default below) or a local install.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start a database

**Option A — Docker (default):**

```bash
docker compose up -d        # MySQL 8 on localhost:3306, db "pm_app"
```

The schema in `db/schema.sql` is applied automatically on first container start.

**Upgrading an existing database?** Apply the migrations in `db/migrations/` in date
order. They add project requests, task types/requests and sign-off, then calendar
subscriptions, video meetings and WhatsApp:

```bash
mysql -u root -p pm_app < db/migrations/2026-09-17_phase4_requests_signoff.sql
mysql -u root -p pm_app < db/migrations/2026-09-18_phase5_calendar_video_whatsapp.sql
mysql -u root -p pm_app < db/migrations/2026-09-18_fix_legacy_completed_at.sql
mysql -u root -p pm_app < db/migrations/2026-09-19_calendar_feed_activity.sql
mysql -u root -p pm_app < db/migrations/2026-09-25_time_log_reporting_index.sql
mysql -u root -p pm_app < db/migrations/2026-09-25_request_priority_and_time.sql
mysql -u root -p pm_app < db/migrations/2026-09-26_request_start_date.sql
```

It is safe to re-run and backfills existing tasks (their creator — or the project owner —
is recorded as requester and approver). From Windows PowerShell, `<` redirection doesn't
work; use `cmd /c "mysql -u root -p pm_app < db\migrations\2026-09-17_phase4_requests_signoff.sql"`.
See **Deploying to production** below for the order of steps.

**Option B — Existing local MySQL:**

```bash
mysql -u root -p < db/schema.sql
```

### 3. Configure environment

```bash
cp .env.example .env.local
```

Then edit `.env.local` so the `MYSQL_*` values point at your database, and set a long
random `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variable              | Purpose                                  |
| --------------------- | ---------------------------------------- |
| `MYSQL_HOST/PORT`     | Database host / port                     |
| `MYSQL_USER/PASSWORD` | Database credentials                     |
| `MYSQL_DATABASE`      | Database name (default `pm_app`)         |
| `AUTH_SECRET`         | Secret used to sign session JWTs (HS256) |
| `SESSION_COOKIE_NAME` | Session cookie name (default `pm_session`) |
| `ATTENDANCE_DB_*`     | Attendance database used for login (defaults to the `MYSQL_*` server, db `attendance`) |
| `CRON_SECRET`         | Required `x-cron-secret` header for `/api/cron/*` |
| `APP_BASE_URL`        | Absolute URL used for links in emails |
| `SMTP_*`              | Email through an ordinary mailbox — host, user, password, from (blank = in-app only) |
| `SES_*`               | Email through AWS SES instead, for higher volume. SMTP wins if both are set |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_*` | Web push (the public key must be set **when building**) |
| `MEETINGS_APP_URL`   | Video meetings app (default `https://meetings.raceinnovations.in`) |
| `MEETINGS_API_KEY`   | Shared secret so PMApp can schedule meetings there (blank = room links only) |
| `WHATSAPP_*`         | WhatsApp Cloud API (blank = WhatsApp alerts off) |
| `INTEGRATION_API_KEY` | Key the Attendance app sends to read PM work (blank = `/api/integrations/*` off) |
| `ATTENDANCE_DB_NAME` | The Attendance schema — **`attendance_db`** on this install, not the `attendance` default |

`.env.local` is git-ignored; `.env.example` is committed.

### 4. Sync users

```bash
npm run seed
```

Copies every employee from the Attendance database into `pm_app.users` (idempotent; it
does not create projects or tasks). Employees are also synced automatically when they log in.

### 5. Run

```bash
npm run dev        # http://localhost:3000
```

For a production build:

```bash
npm run build
npm run start
```

## Logging in

Use an **Employee ID + PIN** from the Attendance app. There are no built-in demo accounts.
For local development without the Attendance database, `npm run db:dev` starts a
passwordless MySQL on port 3307 you can load a dump into.

## Access model

**Admin** can manage all users (create/edit/deactivate/reset password/assign role), create
and manage any project, manage membership, and view the activity log.

**Project lead** (per project) creates and edits tasks, approves or rejects task requests
(not their own) and project requests they were nominated for, marks tasks Done and can
sign them off (not tasks they own). "Requested by" can't be changed once a task is Done.
Only admins and existing leads can be nominated to approve a project request.

**Member** sees only the projects they belong to and the tasks within them; can request
projects and raise task requests, and can sign off tasks they requested; can move the
status of tasks assigned to them (up to Review) and comment; has a personal *My Tasks* view; can edit their
own profile/password. Members **cannot** reach any `/admin/*` page or admin API — those
return `403` (APIs) or redirect to `/dashboard` (pages). Unauthenticated requests get `401`
(APIs) or redirect to `/login` (pages).

## Scripts

| Command         | Description                          |
| --------------- | ----------------------------------- |
| `npm run dev`   | Start the dev server (Turbopack)    |
| `npm run build` | Production build + type-check       |
| `npm run start` | Serve the production build          |
| `npm run lint`  | ESLint                              |
| `npm run seed`  | Seed/refresh test data (idempotent) |
| `npm test`      | Unit tests (workflow rules, validation, PDF) |
| `npm run test:integration` | API tests against a throwaway MySQL |
| `npm run test:all` | Both suites |
| `npm run test:e2e` | Builds, then end-to-end browser tests (Playwright) |
| `npm run smoke` | Smoke-tests a **running** deployment in a real browser |
| `npm run flow` | Full workflow test against a running dev/staging copy (needs DB access) |
| `npm run a11y` | Accessibility (WCAG 2.1 AA) + phone-layout audit of a running copy |
| `npm run db:dev` | Optional passwordless dev MySQL on port 3307 (data in `.mysql-dev/`) |

### End-to-end tests

`npm run test:e2e` builds the app and drives it in Google Chrome through the real
login form (Employee ID + PIN) and the full workflow: project request → lead approval →
task requests (approve / reject) → review → sign-off lock → PDF download → project
completion lock → admin reopen. Each run boots a throwaway MySQL, loads `db/schema.sql`
plus every migration, creates test employees in a throwaway `attendance` database, runs
the `npm run seed` user sync, and starts `next start` on port 3210 (`E2E_PORT`) wired
only to that database with email and push disabled — your own databases are never used.
Set `E2E_BROWSER_CHANNEL=` (empty) to use Playwright's bundled Chromium instead of Chrome
(`npx playwright install chromium`). Failures leave screenshots and traces in
`test-results/` and an HTML report in `playwright-report/`.

### Tests

Unit tests need nothing but `npm install`. Integration tests call the real route
handlers against a temporary MySQL 8.0 started by
[`mysql-memory-server`](https://github.com/Sebastian-Webster/mysql-memory-server-nodejs):
it uses a local MySQL 8.0 install if there is one, otherwise it downloads one on the first
run. To use an existing server instead, set `TEST_MYSQL_HOST` (plus `TEST_MYSQL_PORT`,
`TEST_MYSQL_USER`, `TEST_MYSQL_PASSWORD`); the `pm_test`, `pm_fresh` and `pm_migrate`
databases on it are dropped and recreated.

## Project structure

```
pm-app/
├─ proxy.ts                 # Session + admin gating before requests (jose; no bcrypt here)
├─ app/
│  ├─ login, change-password, dashboard, projects, projects/[id],
│  │  my-tasks, profile, admin, admin/users, admin/activity
│  └─ api/…                 # auth, users, profile, projects, tasks, comments, activity
├─ components/              # AppShell, badges, cards, charts, modals, project board
├─ lib/                     # db, auth, rbac, validation, activity, dashboard, format
├─ scripts/seed.mjs         # idempotent seeding
├─ db/schema.sql            # MySQL schema
└─ docker-compose.yml       # MySQL 8 for local dev
```

## Security notes

- PINs are verified (bcrypt) against the Attendance database and never stored or returned by PMApp.
- The session cookie is `httpOnly`, `sameSite=lax`, and `secure` in production (so use
  HTTPS in production; over plain HTTP a production build will not send the cookie back).
- Authorization is checked server-side on every protected route, with `requireUser()` /
  `requireAdmin()` resolving the **current PMApp user record**. Role/active changes made
  in the Attendance app are picked up within about a minute on open sessions (and at login).
- Login attempts are limited in memory: 8 per client + Employee ID and 20 per Employee ID
  per 15 minutes (per server process).
- User-supplied text is HTML-escaped in emails and CSV cells can't run as spreadsheet formulas.

## Calendar, video calls and WhatsApp

### Setting up email

Two ways, and **SMTP wins if both are configured**:

| | When to use it | What it needs |
| --- | --- | --- |
| **SMTP** | Almost always | An ordinary company mailbox: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Nothing in DNS — the domain already lists its own mail server in SPF. `SMTP_FROM` must be the mailbox you log in as; most providers refuse to send as anything else. |
| **AWS SES** | Thousands of emails a day | Domain verified, DKIM records added, `amazonses.com` in the SPF record, and production access (new accounts can only send to verified recipients). |

Common hosts: GoDaddy `smtpout.secureserver.net:465`, Google Workspace
`smtp.gmail.com:465` (with an App Password), Microsoft 365 `smtp.office365.com:587`.

**Admin Home → Email** has a *Check settings* and a *Send me a test* button. Use them
after any change: email failures are logged rather than shown — a notification that
can't be sent must not break the action behind it — so nothing else tells you the
password is wrong.

## Working with the Attendance app

The Attendance app owns identity and time; PM reads it and never writes to it.
`pm_app.users.employee_id` → `attendance_db.employees.id` is the whole link.

**Work hours** (sidebar) puts the two halves side by side for a week: time at work
(`attendance.total_minutes`) against time logged on tasks (`task_time_logs`). Everyone
sees their own week; a manager also sees whoever reports to them via
`employees.manager_id`; an admin sees everyone. Time logged is grouped by **IST** date —
grouping by UTC would push an evening's work onto the next day.

Read a gap as time not yet logged, not as idleness: meetings, travel and reading rarely
have a task open. On this install 31% of attendance rows are `absent`, which means "no
clock-in recorded" rather than "did not work", and the `leave` status is unused — so PM
deliberately makes no claim about who is on leave.

If the Attendance database can't be reached, the page still shows the PM half with a
notice rather than failing.

**A drop-in for the Attendance side** lives in `integrations/attendance-app/` —
the helper, the panel and the steps to wire it up.

**The other direction** is `GET /api/integrations/employee-work?empId=RACE005`, for the
Attendance app to show someone their PM work on the screen they already open each
morning. Send the shared key as a header:

```bash
curl -H "x-integration-key: $INTEGRATION_API_KEY" \
  "https://projectmanager.raceinnovations.in/api/integrations/employee-work?empId=RACE005"
```

It returns `openCount`, `dueTodayCount`, `overdueCount`, `loggedTodayMinutes` and up to 25
open tasks (soonest deadline first, signed-off work excluded). An employee who has never
opened PM returns `known: false` with empty lists — not an error, so the Attendance app
shows nothing rather than a failure. Set `INTEGRATION_API_KEY` in PM's env; without it the
endpoint answers 503.

### Meeting invitations (nothing to set up)

Scheduling a meeting emails every attendee a **calendar invitation** — the same kind
Outlook and Google Calendar send, with Yes / No / Maybe. Gmail and Outlook put it straight
into the person's own calendar on arrival; nobody has to subscribe to anything or click
anything first. Cancelling the meeting sends a cancellation that removes it again.

It works with Google, Outlook, Apple and anything else that reads email, because it is
ordinary email: a `text/calendar; method=REQUEST` part, not an attachment. The only
requirement is that **email is configured** (`SMTP_*` or `SES_*` in the env) and that people have an
email address on their account — both come from the Attendance app.

Because of this, meetings are **left out of the subscription feed** below when email is
switched on: they already arrive in the person's own calendar, and carrying them twice
would show every meeting twice. If SES is not configured, or someone has no email
address, the feed keeps carrying their meetings so they still see them somewhere.

### Calendar subscription (Google / Outlook / Apple)

The feed covers what nobody wants an email invitation for: **task due dates and
reminders** (plus meetings, when email is off — see above).

On the **Calendar** page, **Add to Google, Outlook or Apple** (also on Profile →
**Calendar subscription**). Each button opens that service's own "add calendar" screen with
the link filled in; confirm there and it is added. To add it by hand instead:

- **Google Calendar:** Other calendars → **+** → From URL → paste → Add calendar.
- **Outlook:** Add calendar → Subscribe from web → paste → Import.
- **Apple Calendar:** File → New Calendar Subscription → paste → OK.

**How do I know it worked?** Google, Outlook and Apple keep the subscription on their
side and never tell the app it exists, so nothing here can say "you are subscribed". What
the app *can* see is the feed being fetched: once a calendar app reads it, the button
changes from "Add to Google, Outlook or Apple" to **Calendar connected** and the panel
says when it was last read. Until then it says so plainly — Google can take a few hours
to check the first time. Resetting the link clears that, because a new link is a new
subscription.

The link itself is the credential (calendar apps can't sign in), so it is unguessable and
per-person. **Reset link** invalidates it everywhere at once. Calendars refresh on their
own schedule — usually a few hours; that is the calendar's choice, not a setting here.
Individual meetings and task due dates also have **Add to calendar** (Google, Outlook) and
an `.ics` download for Apple and desktop apps.

#### When a subscription never fills in

Google and Microsoft fetch the feed **from their own servers**, not from the browser you
added it in. So the address in the link has to be reachable from the public internet — a
link that opens perfectly on your own screen is useless to them if it points at
`localhost`, a `192.168.x` address or a bare machine name. Nothing reports this: the
calendar simply stays empty.

Profile → **Calendar subscription** → **Check it works** fetches the feed the way Google
would and says what happened. The three answers that matter:

| It says | Fix |
| --- | --- |
| points at “localhost” / a private address | Set `APP_BASE_URL` to the public https address staff type into their browser, and restart the app. |
| the feed asked for a login | The running build predates the public-feed rule in `proxy.ts` — deploy the current code. |
| returned a web page instead of a calendar | Something in front of the app (nginx, a WAF, an SSO proxy) is intercepting `/api/calendar/feed/`; let it through unauthenticated. |

Subscription links end in `.ics` because Google and several desktop clients decide how to
treat a feed partly from the extension. Links handed out before that change still work.

### Video meetings

Scheduling a meeting offers:

1. **A room in the company meetings app** (default).
2. **A link you already have** — paste a Zoom, Google Meet or Teams link.
3. **No video call.**

The join link appears on the meeting, in the reminder email and in the calendar entry.

**Connecting the two apps.** With `MEETINGS_API_KEY` set, PMApp schedules the meeting in
the meetings app itself (`POST /api/integrations/meetings`), so it appears there with its
host, time, duration and invited people, exactly as if it had been booked there. Attendees
who have no account are created from their name and email; they set a password with
**Forgot password** the first time they sign in.

To set it up:

1. In the **meetings app**, set `INTEGRATION_API_KEY` to a long random value and redeploy:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. In **PMApp**, set `MEETINGS_API_KEY` to the same value and `MEETINGS_APP_URL` to that
   app's address.

Without the key — or if the meetings app can't be reached — scheduling still works: PMApp
falls back to a plain room link (the room is created when the first person joins) and tells
the organizer it couldn't be scheduled over there.

### WhatsApp alerts (Meta WhatsApp Cloud API)

Everything already sent in-app is also sent to WhatsApp for anyone who adds a mobile
number and ticks the box on their profile. Nothing is sent until the server is configured:

1. In Meta Business: create a WhatsApp app, add and verify the sender number, and copy its
   **phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
2. Create a **permanent access token** for that app → `WHATSAPP_TOKEN`.
3. Submit a message template with **one body parameter**, e.g. body text
   `PMApp: {{1}}`. Once Meta approves it, set `WHATSAPP_TEMPLATE_NAME` (and
   `WHATSAPP_TEMPLATE_LANG`, default `en`). Meta only delivers business-initiated
   messages through an approved template; without one the app sends plain text, which
   only arrives inside a 24-hour reply window (useful for testing).
4. `WHATSAPP_DEFAULT_COUNTRY_CODE` (default `91`) is added to numbers typed without one.

A failed send is logged and never breaks the action that triggered it.

## Deploying to production

Do these in order — the new code needs the new database columns.

1. **Back up** the database (`mysqldump pm_app > backup.sql`). There is no down-migration;
   rolling back = restore the backup and redeploy the previous build.
2. **Upload source only.** Never upload `.env.local` (it overrides production settings),
   `.mysql-dev/`, `.next/`, `node_modules/`, `test-results/` or `playwright-report/`.
   Make sure no `.env.local` exists on the server.
3. **Set production environment variables** (see the table above), including
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` if push is used — it is baked in at build time.
4. **Install and build** on the server with dev dependencies (TypeScript/Tailwind are
   needed to build): `npm ci`, then `npm run build` (optionally `npm prune --omit=dev`).
5. **Stop the old app**, then **run the migrations** in date order:
   `2026-09-17_phase4_requests_signoff.sql`, `2026-09-18_phase5_calendar_video_whatsapp.sql`,
   `2026-09-18_fix_legacy_completed_at.sql` (that one corrects completion
   times left in the server's time zone by the July 2026 backfill; it records that it
   ran, so a second run changes nothing), then
   `2026-09-19_calendar_feed_activity.sql`, then
   `2026-09-25_time_log_reporting_index.sql` and
   `2026-09-25_request_priority_and_time.sql`.
6. **Start the new build** (`npm run start`) and run the phase 4 migration **once more** — it
   backfills any task created by the old app in between. Check
   `SELECT COUNT(*) FROM tasks WHERE requested_by IS NULL` returns 0.
7. **Smoke test** the live site:

   ```bash
   SMOKE_URL=https://your-site SMOKE_ADMIN=ADMIN001 SMOKE_MEMBER=RACE005 \
     SMOKE_PIN=<pin> CRON_SECRET=<secret> npm run smoke
   ```

   It signs in as those two people and walks the critical path in a real browser —
   create a project → lead approves → raise and approve a task request → mark Done →
   sign off (and check it locks) → download the PDF → complete and reopen the project →
   schedule a meeting with a video call → check the calendar feed → run every cron job.
   It creates one project and one meeting named `SMOKE TEST <time>` and deletes both
   through the API afterwards, naming anything it could not remove. `CRON_SECRET` is
   optional; without it the scheduled jobs are skipped.

Behaviour to tell users about: projects already marked **Completed** become read-only
(an admin can reopen them); a project can only be completed once every task is **signed
off**; only admins and existing project leads can be nominated to approve a project request.

## Notes

- This project pins `turbopack.root` in `next.config.ts` because it lives alongside other
  lockfiles; adjust if you relocate it.
- Request gating lives in `proxy.ts` (Next.js 16's name for the former `middleware.ts`).
