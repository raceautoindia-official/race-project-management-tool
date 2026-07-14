import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import RemindersView from "@/components/RemindersView";
import type { Reminder } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RemindersPage() {
  const user = await requirePageUser();
  const rows = await query<DbRow[]>(
    `SELECT id, user_id, title, category, notes, scheduled_at, reminder_minutes,
            recurrence, notify_email, notify_push, is_done
       FROM reminders WHERE user_id = ?
      ORDER BY is_done ASC, scheduled_at ASC`,
    [user.id]
  );
  const reminders = rows.map((r) => ({
    ...r,
    notify_email: Boolean(r.notify_email),
    notify_push: Boolean(r.notify_push),
    is_done: Boolean(r.is_done),
  })) as unknown as Reminder[];

  return (
    <AppShell user={user}>
      <PageHeader
        title="Reminders"
        subtitle="Payment reminders, renewals, follow-ups and any scheduled activity — notified in-app, by email, and by browser push."
      />
      <RemindersView initial={reminders} />
    </AppShell>
  );
}
