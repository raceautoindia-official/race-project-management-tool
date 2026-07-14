import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import ProjectCard from "@/components/ProjectCard";
import NewProjectButton from "@/components/NewProjectButton";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

const PROJECT_SELECT = `
  p.id, p.name, p.description, p.status, p.owner_id,
  p.created_at, p.updated_at, u.name AS owner_name,
  pm_self.role_in_project AS role_in_project,
  (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
`;

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const search = (sp.search ?? "").trim();
  const status = sp.status ?? "";

  const where: string[] = [];
  const params: unknown[] = [user.id];
  if (user.role !== "admin") {
    where.push(
      "p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)"
    );
    params.push(user.id);
  }
  if (search) {
    where.push("p.name LIKE ?");
    params.push(`%${search}%`);
  }
  if (["active", "completed", "archived"].includes(status)) {
    where.push("p.status = ?");
    params.push(status);
  } else if (status !== "all") {
    // Default view hides archived projects.
    where.push("p.status <> 'archived'");
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await query<DbRow[]>(
    `SELECT ${PROJECT_SELECT}
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     LEFT JOIN project_members pm_self
       ON pm_self.project_id = p.id AND pm_self.user_id = ?
     ${whereSql}
     ORDER BY p.created_at DESC`,
    params
  );
  const projects = rows as unknown as Project[];

  let users: DbRow[] = [];
  if (user.role === "admin") {
    users = await query<DbRow[]>(
      `SELECT id, name, email FROM users WHERE is_active = TRUE ORDER BY name`
    );
  }

  return (
    <AppShell user={user}>
      <PageHeader
        title="Projects"
        subtitle={
          user.role === "admin"
            ? "All projects across the organization."
            : "Projects you are a member of."
        }
        action={
          user.role === "admin" ? (
            <NewProjectButton
              users={users.map((u) => ({ id: u.id, name: u.name, email: u.email }))}
            />
          ) : undefined
        }
      />

      <form method="get" className="mb-5 flex flex-wrap gap-2">
        <input
          name="search"
          defaultValue={search}
          placeholder="Search projects…"
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <select
          name="status"
          defaultValue={status}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Active &amp; completed</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
          <option value="all">All (incl. archived)</option>
        </select>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Filter
        </button>
      </form>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400">
          No projects found.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
