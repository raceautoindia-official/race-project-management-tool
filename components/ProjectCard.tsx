import Link from "next/link";
import { ProjectStatusBadge, RequestStatusBadge, RoleBadge } from "./Badge";
import { DepartmentBadge } from "./DepartmentField";
import { projectPercent } from "@/lib/progress";
import { DateRange, HealthBadge } from "@/components/work/kit";
import type { Project } from "@/lib/types";

export default function ProjectCard({ project }: { project: Project }) {
  const total = project.task_count ?? 0;
  const done = project.done_count ?? 0;
  // Counted in checklist items, so a task nine-tenths ticked is not nothing.
  const pct = projectPercent({
    units: project.progress_units ?? 0,
    credited: project.progress_done ?? 0,
  });

  return (
    <Link
      href={`/projects/${project.id}`}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{project.name}</h3>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <DepartmentBadge name={project.department} />
          {project.approval_status && project.approval_status !== "approved" ? (
            <RequestStatusBadge status={project.approval_status} />
          ) : (
            <ProjectStatusBadge status={project.status} />
          )}
        </div>
      </div>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-slate-600">
        {project.description || "No description"}
      </p>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-slate-600">
        <span className="figure font-medium text-slate-800">{pct}%</span> complete
        <span className="text-slate-500">
          {" · "}
          {done}/{total} tasks done
        </span>
      </div>

      {/* Schedule: the dates, and whether approved progress keeps up with them. */}
      <div className="mt-3 flex items-start justify-between gap-2">
        <DateRange
          start={project.start_date}
          due={project.due_date}
          finished={project.status !== "active" || pct >= 100}
        />
        <HealthBadge approved={pct} start={project.start_date} due={project.due_date} />
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
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
