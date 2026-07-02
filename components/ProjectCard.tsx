import Link from "next/link";
import { ProjectStatusBadge, RoleBadge } from "./Badge";
import type { Project } from "@/lib/types";

export default function ProjectCard({ project }: { project: Project }) {
  const total = project.task_count ?? 0;
  const done = project.done_count ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{project.name}</h3>
        <ProjectStatusBadge status={project.status} />
      </div>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-slate-500">
        {project.description || "No description"}
      </p>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-slate-400">
        {done}/{total} tasks done ({pct}%)
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          {project.member_count ?? 0} member
          {(project.member_count ?? 0) === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          {project.role_in_project && <RoleBadge role={project.role_in_project} />}
          {project.owner_name && <span>Owner: {project.owner_name}</span>}
        </div>
      </div>
    </Link>
  );
}
