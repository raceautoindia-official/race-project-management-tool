import { requirePageAdmin } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import CredentialsVault, { type VaultEntry } from "@/components/CredentialsVault";
import { secretsConfigured, secretsProblem } from "@/lib/secrets";
import { formatIst } from "@/lib/tz";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  const user = await requirePageAdmin();

  const rows = await query<DbRow[]>(
    `SELECT c.id, c.name, c.url, c.username, c.project_id, c.updated_at,
            p.name AS project_name, u.name AS updated_by_name,
            (SELECT COUNT(*) FROM credential_views v WHERE v.credential_id = c.id) AS views,
            (SELECT MAX(v.viewed_at) FROM credential_views v WHERE v.credential_id = c.id) AS last_viewed
       FROM credentials c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = c.updated_by
      ORDER BY c.name`
  );

  const projectRows = await query<DbRow[]>(
    `SELECT id, name FROM projects WHERE status <> 'archived' ORDER BY name`
  );

  // Who read what, most recent first — the answer to "who has this login".
  const viewRows = await query<DbRow[]>(
    `SELECT v.credential_name, v.viewed_at, u.name AS user_name
       FROM credential_views v
       LEFT JOIN users u ON u.id = v.user_id
      ORDER BY v.viewed_at DESC
      LIMIT 25`
  );

  return (
    <AppShell user={user}>
      <PageHeader
        title="Credentials"
        subtitle="Website logins the team shares — encrypted, admin only, every read recorded."
      />

      <CredentialsVault
        initial={rows as unknown as VaultEntry[]}
        projects={projectRows.map((p) => ({ id: p.id as number, name: p.name as string }))}
        configured={secretsConfigured()}
        problem={secretsProblem()}
      />

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Recently read</h2>
        {viewRows.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Nobody has read a password yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {viewRows.map((v, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="text-slate-700">
                  <span className="font-medium">{(v.user_name as string) ?? "Someone"}</span>{" "}
                  read <span className="font-medium">{v.credential_name as string}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {formatIst(String(v.viewed_at))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
