# PM App — Internal Project Management Tool

A full-stack, role-based project management app built with **Next.js 16 (App Router)**,
**React 19**, **MySQL 8**, and a custom JWT session auth. It is an **internal** tool:
there is **no public sign-up** — an admin provisions every account.

## Features

- **Role-based access (admin / member)** enforced **server-side** in middleware *and* in
  every API route — not just hidden in the UI.
- **Custom auth**: bcrypt password hashing, signed JWT session in an **httpOnly** cookie
  (via `jose`), Edge middleware for route protection, basic login rate-limiting.
- **Forced password change** on first login (and after an admin resets a password).
- **Admin user management**: create users, assign roles, deactivate/reactivate, reset
  passwords — with search & pagination.
- **Projects**: CRUD, membership management (lead/member), progress tracking.
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

`.env.local` is git-ignored; `.env.example` is committed.

### 4. Seed test data

```bash
npm run seed
```

This is **idempotent** (safe to re-run). It hashes passwords before inserting and creates
the users, projects, tasks, comments, and activity below.

### 5. Run

```bash
npm run dev        # http://localhost:3000
```

For a production build:

```bash
npm run build
npm run start
```

## Test credentials

> ⚠️ These are for **local development only**. Change them (or delete the users) before
> using this anywhere real.

| Role   | Email              | Password      |
| ------ | ------------------ | ------------- |
| Admin  | `admin@pmapp.test` | `Admin@12345` |
| Member | `alex@pmapp.test`  | `User@12345`  |
| Member | `sam@pmapp.test`   | `User@12345`  |

## Access model

**Admin** can manage all users (create/edit/deactivate/reset password/assign role), create
and manage any project, manage membership, and view the activity log.

**Member** sees only the projects they belong to and the tasks within them; can create and
update tasks, move task status, and comment; has a personal *My Tasks* view; can edit their
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

## Project structure

```
pm-app/
├─ middleware.ts            # Edge auth + admin gating (jose; no bcrypt here)
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

- Passwords are hashed with bcrypt; hashes are never returned to the client.
- The session cookie is `httpOnly`, `sameSite=lax`, and `secure` in production (so use
  HTTPS in production; over plain HTTP a production build will not send the cookie back).
- Authorization is checked server-side on every protected route, with `requireUser()` /
  `requireAdmin()` resolving the **current DB record** so role/active changes take effect
  immediately.
- The login endpoint has basic in-memory rate-limiting.

## Notes

- This project pins `turbopack.root` in `next.config.ts` because it lives alongside other
  lockfiles; adjust if you relocate it.
- Next.js 16 prints a deprecation notice suggesting `proxy.ts` over `middleware.ts`. The
  `middleware.ts` convention still works in 16 and is used here per the project spec.
