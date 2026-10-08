import { requirePageAdmin } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import Avatar from "@/components/Avatar";
import { CATEGORY_LABELS } from "@/components/MyDocuments";
import { formatIst } from "@/lib/tz";

export const dynamic = "force-dynamic";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Everyone's personal documents, by person.
 *
 * Reading one is recorded against the admin who opened it — the download
 * goes through the same route the owner uses, which writes to the activity
 * log when the person opening it is not the person it belongs to.
 */
export default async function AdminDocumentsPage() {
  const user = await requirePageAdmin();

  const rows = await query<DbRow[]>(
    `SELECT d.id, d.user_id, d.category, d.note, d.filename, d.size_bytes,
            d.created_at, u.name AS user_name, u.emp_id
       FROM user_documents d JOIN users u ON u.id = d.user_id
      ORDER BY u.name, d.created_at DESC`
  );

  const byPerson = new Map<number, { name: string; empId: string; docs: DbRow[] }>();
  for (const row of rows) {
    const id = row.user_id as number;
    const entry = byPerson.get(id);
    if (entry) entry.docs.push(row);
    else
      byPerson.set(id, {
        name: row.user_name as string,
        empId: (row.emp_id as string) ?? "",
        docs: [row],
      });
  }

  return (
    <AppShell user={user}>
      <PageHeader
        title="Personal documents"
        subtitle="What people have uploaded about themselves. Opening one is recorded in the activity log."
      />

      {byPerson.size === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">
          Nobody has uploaded anything yet.
        </div>
      ) : (
        <div className="space-y-4">
          {[...byPerson.entries()].map(([id, person]) => (
            <section key={id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
                <Avatar name={person.name} size="sm" />
                <div>
                  <p className="font-semibold text-slate-800">{person.name}</p>
                  {person.empId && (
                    <p className="text-xs text-slate-500">{person.empId}</p>
                  )}
                </div>
                <span className="ml-auto text-xs text-slate-500">
                  {person.docs.length} document{person.docs.length === 1 ? "" : "s"}
                </span>
              </header>
              <ul className="divide-y divide-slate-100">
                {person.docs.map((d) => (
                  <li
                    key={d.id as number}
                    className="flex items-center justify-between gap-3 px-5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {d.filename as string}
                      </p>
                      <p className="text-xs text-slate-500">
                        {CATEGORY_LABELS[d.category as string] ?? (d.category as string)}
                        {d.note ? ` · ${d.note as string}` : ""} ·{" "}
                        {fmtBytes(Number(d.size_bytes))} · {formatIst(String(d.created_at))}
                      </p>
                    </div>
                    <a
                      href={`/api/documents/${d.id}`}
                      className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
