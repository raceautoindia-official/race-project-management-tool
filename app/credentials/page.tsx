import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import CredentialsVault, { type VaultEntry } from "@/components/CredentialsVault";
import { listCredentials } from "@/lib/credentials";
import { secretsConfigured, secretsProblem } from "@/lib/secrets";
import { formatIst } from "@/lib/tz";

export const dynamic = "force-dynamic";

/**
 * The shared store of website logins.
 *
 * Everyone can open it; what is in it depends on what has been shared with
 * them. Admins additionally add, change and delete, and see who has been
 * reading what.
 */
export default async function CredentialsPage() {
  const user = await requirePageUser();
  const isAdmin = user.role === "admin";

  const rows = await listCredentials(user);

  const projectRows = isAdmin
    ? await query<DbRow[]>(
        `SELECT id, name FROM projects WHERE status <> 'archived' ORDER BY name`
      )
    : [];
  const userRows = isAdmin
    ? await query<DbRow[]>(
        `SELECT id, name FROM users WHERE is_active = TRUE ORDER BY name`
      )
    : [];
  const peopleRows = isAdmin
    ? await query<DbRow[]>(
        `SELECT credential_id, user_id FROM credential_access`
      )
    : [];

  // Who read what, most recent first — the answer to "who has this login".
  const viewRows = isAdmin
    ? await query<DbRow[]>(
        `SELECT v.credential_name, v.viewed_at, u.name AS user_name
           FROM credential_views v
           LEFT JOIN users u ON u.id = v.user_id
          ORDER BY v.viewed_at DESC
          LIMIT 25`
      )
    : [];

  const shared: Record<number, number[]> = {};
  for (const row of peopleRows) {
    const key = row.credential_id as number;
    (shared[key] ??= []).push(row.user_id as number);
  }

  return (
    <AppShell user={user}>
      <PageHeader
        title="Credentials"
        subtitle={
          isAdmin
            ? "Website logins the team shares — encrypted, and every read is recorded."
            : "Website logins shared with you. Every read is recorded."
        }
      />

      <CredentialsVault
        initial={rows as unknown as VaultEntry[]}
        projects={projectRows.map((p) => ({ id: p.id as number, name: p.name as string }))}
        people={userRows.map((u) => ({ id: u.id as number, name: u.name as string }))}
        sharedWith={shared}
        canManage={isAdmin}
        configured={secretsConfigured()}
        problem={isAdmin ? secretsProblem() : null}
      />

      {isAdmin && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Recently read</h2>
          {viewRows.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              Nobody has read a password yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {viewRows.map((v, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="text-slate-700">
                    <span className="font-medium">
                      {(v.user_name as string) ?? "Someone"}
                    </span>{" "}
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
      )}
    </AppShell>
  );
}
