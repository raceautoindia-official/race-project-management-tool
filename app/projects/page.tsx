import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import ProjectCard from "@/components/ProjectCard";
import NewProjectButton from "@/components/NewProjectButton";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Projects gathered under the department that owns them, biggest first, with
 * the unplaced ones last — they are a to-do, not a department.
 */
function groupByDepartment(projects: Project[]): [string, Project[]][] {
  const groups = new Map<string, Project[]>();
  for (const p of projects) {
    const key = p.department || "No department";
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === "No department") return 1;
    if (b[0] === "No department") return -1;
    return b[1].length - a[1].length || a[0].localeCompare(b[0]);
  });
}

const PROJECT_SELECT = `
  p.id, p.name, p.description, p.department, p.status, p.approval_status, p.owner_id,
  p.requested_by, p.created_at, p.updated_at, u.name AS owner_name,
  pm_self.role_in_project AS role_in_project,
  (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
`;

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; department?: string }>;
}) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const search = (sp.search ?? "").trim();
  const status = sp.status ?? "";
  const department = (sp.department ?? "").trim();

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
  // "none" asks for the projects nobody has placed yet, which is a real
  // question while departments are still being filled in.
  if (department === "none") {
    where.push("(p.department IS NULL OR p.department = '')");
  } else if (department) {
    where.push("p.department = ?");
    params.push(department);
  }
  if (["active", "completed", "archived"].includes(status)) {
    where.push("p.status = ?");
    params.push(status);
  } else if (status === "pending") {
    where.push("p.approval_status = 'pending'");
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

  // The department list is whatever is in use — there is no table of them,
  // because the list belongs to the Attendance app.
  const departmentRows = await query<DbRow[]>(
    `SELECT DISTINCT name FROM (
       SELECT department AS name FROM users
        WHERE department IS NOT NULL AND department <> ''
       UNION
       SELECT department FROM projects
        WHERE department IS NOT NULL AND department <> ''
     ) d ORDER BY name`
  );
  const departments = departmentRows.map((d) => String(d.name));

  // Admins pick members; everyone else picks the lead who approves a request.
  const users = await query<DbRow[]>(
    `SELECT u.id, u.name, u.email, u.designation,
            (u.role = 'admin' OR EXISTS (
              SELECT 1 FROM project_members pm
                JOIN projects p ON p.id = pm.project_id AND p.approval_status = 'approved'
               WHERE pm.user_id = u.id AND pm.role_in_project = 'lead'
            )) AS can_lead
       FROM users u
      WHERE u.is_active = TRUE
      ORDER BY u.name`
  );

  return (
    <AppShell user={user}>
      <PageHeader
        title="Projects"
        subtitle={
          user.role === "admin"
            ? "All projects across the organization."
            : "Projects you are a member of, including projects you requested."
        }
        action={
          <NewProjectButton
            isAdmin={user.role === "admin"}
            currentUserId={user.id}
            defaultDepartment={user.department}
            users={users.map((u) => ({
              id: u.id,
              name: u.name,
              email: u.email,
              designation: (u.designation as string | null) ?? null,
              canLead: Boolean(Number(u.can_lead)),
            }))}
          />
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
          name="department"
          aria-label="Filter projects by department"
          defaultValue={department}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value="none">No department</option>
        </select>
        <select
          name="status"
          aria-label="Filter projects by status"
          defaultValue={status}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All except archived</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
          <option value="pending">Pending approval</option>
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
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No projects found.
        </div>
      ) : department ? (
        // Already one department: a heading repeating it would say nothing.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {groupByDepartment(projects).map(([name, items]) => (
            <section key={name}>
              <h2 className="mb-3 flex items-baseline gap-2">
                <span className="text-lg font-semibold text-slate-900">{name}</span>
                <span className="figure text-sm text-slate-600">
                  {items.length}
                </span>
                <span className="text-sm text-slate-600">
                  {items.length === 1 ? "project" : "projects"}
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
