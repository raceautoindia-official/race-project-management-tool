import Link from "next/link";
import { requirePageAdmin } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import ExportButton from "@/components/ExportButton";
import { formatDateTime, humanizeAction } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function summarizeMetadata(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const entries = Object.entries(meta as Record<string, unknown>);
  return entries
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; page?: string }>;
}) {
  const admin = await requirePageAdmin();
  const sp = await searchParams;
  const action = (sp.action ?? "").trim();
  const entityType = (sp.entityType ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const where: string[] = [];
  const params: unknown[] = [];
  if (action) {
    where.push("al.action = ?");
    params.push(action);
  }
  if (entityType) {
    where.push("al.entity_type = ?");
    params.push(entityType);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await query<DbRow[]>(
    `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
            al.metadata, al.created_at, u.name AS user_name
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     ${whereSql}
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params
  );
  const [{ total }] = await query<DbRow[]>(
    `SELECT COUNT(*) AS total FROM activity_log al ${whereSql}`,
    params
  );

  const distinctActions = await query<DbRow[]>(
    `SELECT DISTINCT action FROM activity_log ORDER BY action`
  );

  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));

  function pageHref(p: number) {
    const q = new URLSearchParams();
    if (action) q.set("action", action);
    if (entityType) q.set("entityType", entityType);
    q.set("page", String(p));
    return `/admin/activity?${q.toString()}`;
  }

  return (
    <AppShell user={admin}>
      <PageHeader
        title="Activity log"
        subtitle="Audit trail of key actions across the workspace."
        action={<ExportButton href="/api/activity/export" />}
      />

      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <select
          name="action"
          defaultValue={action}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">All actions</option>
          {distinctActions.map((a) => (
            <option key={a.action} value={a.action}>
              {humanizeAction(a.action)}
            </option>
          ))}
        </select>
        <select
          name="entityType"
          defaultValue={entityType}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">All entities</option>
          <option value="user">User</option>
          <option value="project">Project</option>
          <option value="task">Task</option>
        </select>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Filter
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No activity found.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {formatDateTime(r.created_at)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.user_name ?? "System"}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {humanizeAction(r.action)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.entity_type}
                    {r.entity_id ? ` #${r.entity_id}` : ""}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-xs text-slate-400">
                    {summarizeMetadata(r.metadata)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>
          {Number(total)} entr{Number(total) === 1 ? "y" : "ies"} · page {page} of{" "}
          {totalPages}
        </span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
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
              href={pageHref(page + 1)}
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
    </AppShell>
  );
}
