import Link from "next/link";
import { ProjectStatusBadge, RequestStatusBadge, RoleBadge } from "./Badge";
import { DepartmentBadge } from "./DepartmentField";
import { projectPercent } from "@/lib/progress";
import { HealthBadge } from "@/components/work/kit";
import ScheduleTrack from "@/components/work/ScheduleTrack";
import type { Project } from "@/lib/types";

export default function ProjectCard({ project }: { project: Project }) {
  const total = project.task_count ?? 0;
  const done = project.done_count ?? 0;
  // Approved work by weight: each task's approved subtasks count, so a task
  // nine-tenths approved is not nothing.
  const pct = projectPercent({
    units: project.progress_units ?? 0,
    credited: project.progress_done ?? 0,
  });

  return (
    <Link
      href={`/projects/${project.id}`}
      className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md"
    >
      <div className="h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500" aria-hidden />
      <div className="flex flex-1 flex-col p-5">
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

      <div className="mt-3 flex items-baseline justify-between gap-2 text-xs text-slate-600">
        <span>
          <span className="figure text-lg font-bold text-slate-900">{pct}%</span> complete
        </span>
        <span className="text-slate-500">
          {done}/{total} tasks approved
        </span>
      </div>
      {/* Time used against work approved, and when it will finish at this pace. */}
      <ScheduleTrack
        variant="compact"
        approved={pct}
        start={project.start_date}
        due={project.due_date}
        className="mt-2"
      />

      {/* The dates, and whether approved progress keeps up with them. */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="figure text-xs text-slate-600">
          📅 {dayMonth(project.start_date)} → {dayMonth(project.due_date)}
        </span>
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
      </div>
    </Link>
  );
}

/** "7 Oct". This card renders on the server, so it can't use the client kit's shortDate. */
function dayMonth(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
