# Showing PM work inside the Attendance app

These two files are **not part of PM App**. They are a drop-in for the
Attendance app (worklens), which is a separate Next.js project on the same
server. They live here so they stay next to the endpoint they call and are
versioned with it.

PM already reads the Attendance database directly — that is the **Work hours**
page. This is the other direction: the Attendance app showing someone their PM
work on the screen they already open every morning.

```
Attendance app (worklens.raceinnovations.in)
   │  GET /api/integrations/employee-work?empId=RACE005
   │  header: x-integration-key
   ▼
PM App (projectmanager.raceinnovations.in)
```

## 1. Switch the endpoint on, in PM

Generate a key and put it in PM's `.env.local`:

```bash
cd ~/pm-app
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# INTEGRATION_API_KEY=<paste it>
pm2 restart ecosystem.config.cjs --update-env
```

Until this is set the endpoint answers **503** by design — it refuses to run
unauthenticated rather than serving everyone's workload to anyone who asks.

Check it:

```bash
SECRET=$(sed -n s/^INTEGRATION_API_KEY=//p .env.local | head -1 | tr -d '\r')
curl -s -H "x-integration-key: $SECRET" \
  "https://projectmanager.raceinnovations.in/api/integrations/employee-work?empId=RACE010"
```

You should get JSON with `known: true` and a `tasks` array.

## 2. Copy these files into the Attendance app

```
pm-work.ts        → lib/pm-work.ts
PmWorkPanel.tsx   → components/PmWorkPanel.tsx
```

Add to the Attendance app's own env, using the **same key**:

```
PM_APP_URL=https://projectmanager.raceinnovations.in
PM_INTEGRATION_KEY=<the same value as PM's INTEGRATION_API_KEY>
```

## 3. Use it on the check-in screen

`fetchPmWork` must run **on the server** — the key must never reach a browser.

App Router (a server component):

```tsx
import { fetchPmWork } from "@/lib/pm-work";
import PmWorkPanel from "@/components/PmWorkPanel";

export default async function CheckInPage() {
  const work = await fetchPmWork(currentEmployee.emp_id);
  return (
    <>
      {/* the existing check-in UI */}
      <PmWorkPanel work={work} />
    </>
  );
}
```

Pages Router:

```tsx
export async function getServerSideProps(ctx) {
  const work = await fetchPmWork(empIdFromSession(ctx));
  return { props: { work } };
}
```

For the **mobile app**, wrap it in a route handler the phone calls with its own
session, and have that handler look up the signed-in employee's `emp_id`
itself — never accept an `empId` from the client, or anyone could read any
colleague's workload:

```ts
// app/api/my-pm-work/route.ts — in the Attendance app
export async function GET(req: Request) {
  const employee = await requireAuth(req);        // its own auth
  return Response.json(await fetchPmWork(employee.emp_id));
}
```

## How it behaves when things go wrong

`fetchPmWork` never throws. If PM is down, slow (it gives up after 4 seconds),
or the key is wrong, it returns an empty result and the panel renders nothing.
Clocking in must never depend on PM being up.

An employee who has never signed in to PM returns `known: false` — not an
error, so the panel simply doesn't appear for them.

## What the endpoint returns

```json
{
  "empId": "RACE010", "known": true, "name": "M Derin",
  "openCount": 2, "dueTodayCount": 1, "overdueCount": 2,
  "loggedTodayMinutes": 90,
  "tasks": [
    { "id": 14, "title": "Add log page", "project": "Payments",
      "status": "review", "priority": "high",
      "dueDate": "2026-09-24", "overdue": true,
      "url": "https://projectmanager.raceinnovations.in/projects/9" }
  ],
  "url": "https://projectmanager.raceinnovations.in/my-tasks"
}
```

Open tasks only, soonest deadline first, at most 25. Signed-off and Done work
is excluded, as are unapproved and archived projects.
