import Link from "next/link";
import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import MarkAllReadButton from "@/components/MarkAllReadButton";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePageUser();
  const page = Math.max(1, Number((await searchParams).page ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const rows = await query<DbRow[]>(
    `SELECT id, type, message, link, is_read, created_at
       FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    [user.id]
  );
  const [{ total }] = await query<DbRow[]>(
    `SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?`,
    [user.id]
  );
  const [{ unread }] = await query<DbRow[]>(
    `SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = FALSE`,
    [user.id]
  );
  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));

  return (
    <AppShell user={user}>
      <PageHeader
        title="Notifications"
        subtitle={`${Number(unread)} unread · ${Number(total)} total`}
        action={Number(unread) > 0 ? <MarkAllReadButton /> : undefined}
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
          No notifications yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <ul className="divide-y divide-slate-100">
            {rows.map((n) => {
              const inner = (
                <div
                  className={`flex items-center justify-between gap-3 px-5 py-3 ${
                    n.is_read ? "" : "bg-indigo-50/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {!n.is_read && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
                    )}
                    <span
                      className={`text-sm ${
                        n.is_read ? "text-slate-500" : "font-medium text-slate-800"
                      }`}
                    >
                      {n.message}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {formatRelative(n.created_at)}
                  </span>
                </div>
              );
              return n.link ? (
                <li key={n.id}>
                  <Link href={n.link} className="block hover:bg-slate-50">
                    {inner}
                  </Link>
                </li>
              ) : (
                <li key={n.id}>{inner}</li>
              );
            })}
          </ul>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={`/notifications?page=${page - 1}`}
                className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
              >
                Previous
              </Link>
            ) : (
              <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-300">
                Previous
              </span>
            )}
            {page < totalPages ? (
              <Link
                href={`/notifications?page=${page + 1}`}
                className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
              >
                Next
              </Link>
            ) : (
              <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-300">
                Next
              </span>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
