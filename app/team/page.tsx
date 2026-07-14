import Link from "next/link";
import { requirePageUser } from "@/lib/page-guard";
import { getTeamPerformance, ontimePct, effortPct } from "@/lib/performance";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import { RoleBadge } from "@/components/Badge";
import Avatar from "@/components/Avatar";
import ExportButton from "@/components/ExportButton";
import { ProgressBar } from "@/components/ProgressBar";
import { formatHM } from "@/lib/tz";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

const SUBTITLES = {
  all: "Individual status and 30-day performance for every member.",
  led: "Individual status and 30-day performance for members of the projects you lead.",
  self: "Your individual status and 30-day performance.",
} as const;

export default async function TeamPage() {
  const user = await requirePageUser();
  const { scope, members } = await getTeamPerformance(user);
  const showExport = scope !== "self";

  return (
    <AppShell user={user}>
      <PageHeader
        title="Team performance"
        subtitle={SUBTITLES[scope]}
        action={showExport ? <ExportButton href="/api/team/export" /> : undefined}
      />

      <div className="space-y-4">
        {members.map((m) => {
          const otp = ontimePct(m);
          const eff = effortPct(m);
          return (
            <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-5">
              {/* Header row: identity + presence + working-on */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Avatar name={m.name} size="lg" />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                        m.online ? "bg-green-500" : "bg-slate-300"
                      }`}
                      title={m.online ? "Online" : "Offline"}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{m.name}</span>
                      <RoleBadge role={m.role} />
                    </div>
                    <div className="text-xs text-slate-400">
                      {m.emp_id} ·{" "}
                      {m.online
                        ? "Active now"
                        : m.last_seen_at
                          ? `Last seen ${formatRelative(m.last_seen_at)}`
                          : "Never signed in"}
                    </div>
                  </div>
                </div>
                <div className="min-w-0 max-w-md text-right">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Working on now
                  </div>
                  {m.working_on.length === 0 ? (
                    <div className="text-sm text-slate-400">
                      {m.in_review > 0 ? "Awaiting review" : "Nothing in progress"}
                    </div>
                  ) : (
                    m.working_on.map((w) => (
                      <Link
                        key={w.id}
                        href={`/projects/${w.project_id}`}
                        className="block truncate text-sm text-indigo-600 hover:underline"
                      >
                        {w.title}
                        <span className="text-slate-400"> · {w.project_name}</span>
                      </Link>
                    ))
                  )}
                </div>
              </div>

              {/* Stats row */}
              <div className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4 lg:grid-cols-7">
                <Stat label="Open" value={m.open_tasks} />
                <Stat label="In progress" value={m.in_progress} />
                <Stat label="In review" value={m.in_review} tone={m.in_review ? "amber" : undefined} />
                <Stat label="Overdue" value={m.overdue_now} tone={m.overdue_now ? "red" : undefined} />
                <Stat label="Done (30d)" value={m.completed_30d} tone="green" />
                <Stat
                  label="On-time"
                  value={otp === null ? "—" : `${otp}%`}
                  tone={otp !== null && otp < 60 ? "red" : otp !== null ? "green" : undefined}
                  hint={
                    otp === null
                      ? "no due-dated completions"
                      : `${m.ontime_30d}/${m.due_completed_30d} on time`
                  }
                />
                <Stat label="Logged (30d)" value={formatHM(m.minutes_30d / 60)} />
              </div>

              {/* On-time + effort bars */}
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>On-time completion (30d)</span>
                    <span>{otp === null ? "n/a" : `${otp}%`}</span>
                  </div>
                  <ProgressBar value={otp ?? 0} tone={(otp ?? 0) >= 60 ? "green" : "indigo"} />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>Effort vs estimate (completed work)</span>
                    <span>
                      {eff === null
                        ? "n/a"
                        : `${eff}%${eff > 100 ? " (over)" : eff < 100 ? " (under)" : ""}`}
                    </span>
                  </div>
                  <ProgressBar value={Math.min(eff ?? 0, 100)} tone={eff !== null && eff > 100 ? "green" : "indigo"} />
                </div>
              </div>
            </div>
          );
        })}
        {members.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
            No members in scope.
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "red" | "green" | "amber";
  hint?: string;
}) {
  const ink =
    tone === "red"
      ? "text-red-600"
      : tone === "green"
        ? "text-green-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-slate-900";
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2" title={hint}>
      <div className={`text-lg font-bold ${ink}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}
