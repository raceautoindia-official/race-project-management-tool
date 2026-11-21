"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, isConflict } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatIst } from "@/lib/tz";
import { canDecideProject } from "@/lib/workflow";
import type { ProjectMember, ProjectStatus, RequestStatus, Role } from "@/lib/types";

interface Person {
  id: number;
  name: string;
}

export interface BannerProject {
  id: number;
  name: string;
  status: ProjectStatus;
  owner_id: number | null;
  owner_name: string | null;
  approval_status: RequestStatus;
  requested_by: number | null;
  requester_name: string | null;
  requested_at: string | null;
  decider_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

/**
 * The project's lifecycle state above the board:
 *  - pending request → nominated lead/admin approves or rejects; requester can withdraw.
 *    An admin approving it picks the project's lead (whoever asked for it, by
 *    default) and can add members in the same step.
 *  - rejected request → reason; requester/admin can delete it
 *  - completed → read-only; an admin can reopen
 *  - every task signed off → prompt the lead to mark the project completed
 */
export default function ProjectStatusBanner({
  project,
  currentUser,
  canManage,
  readyToComplete,
  onProjectChange,
  members = [],
  allUsers = [],
  onMembersChange,
}: {
  project: BannerProject;
  currentUser: { id: number; role: Role; name: string };
  canManage: boolean;
  readyToComplete: boolean;
  onProjectChange: (patch: Partial<BannerProject>) => void;
  /** Who is on the project now, and everyone who could be (for an admin's approval). */
  members?: ProjectMember[];
  allUsers?: Person[];
  onMembersChange?: (members: ProjectMember[]) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // An admin's approval step: the lead (whoever asked for it, by default) and extra members.
  const [staffing, setStaffing] = useState(false);
  const [leadId, setLeadId] = useState<number | null>(project.requested_by ?? project.owner_id);
  const [added, setAdded] = useState<number[]>([]);

  const isAdmin = currentUser.role === "admin";
  const isRequester = project.requested_by === currentUser.id;
  const mayDecide = canDecideProject(currentUser, project);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      // Decided or changed by someone else: show the project's current state.
      if (isConflict(e)) {
        try {
          const detail = await apiFetch<{ project: Partial<BannerProject> }>(`/api/projects/${project.id}`);
          onProjectChange(detail.project);
          setRejecting(false);
        } catch {
          // keep the error already shown
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const decide = (decision: "approve" | "reject") =>
    run(async () => {
      const res = await apiFetch<{ project: Partial<BannerProject> }>(
        `/api/projects/${project.id}/decision`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            note: decision === "reject" ? reason : null,
            ...(decision === "approve" && isAdmin && staffing ? { leadId, memberIds: added } : {}),
          }),
        }
      );
      onProjectChange({
        approval_status: res.project.approval_status,
        decided_at: res.project.decided_at ?? null,
        decision_note: res.project.decision_note ?? null,
        decider_name: currentUser.name,
        ...(res.project.owner_id !== undefined ? { owner_id: res.project.owner_id, owner_name: res.project.owner_name ?? null } : {}),
      });
      if (decision === "approve" && onMembersChange) {
        try {
          onMembersChange((await apiFetch<{ members: ProjectMember[] }>(`/api/projects/${project.id}/members`)).members);
        } catch {
          // the page refresh below brings them
        }
      }
      setStaffing(false);
      setRejecting(false);
      toast(decision === "approve" ? "Project approved" : "Project request rejected");
      router.refresh();
    });

  const removeRequest = () => {
    const verb = project.approval_status === "pending" ? "Withdraw" : "Delete";
    if (!confirm(`${verb} the request for "${project.name}"?`)) return;
    return run(async () => {
      await apiFetch(`/api/projects/${project.id}`, { method: "DELETE" });
      toast(project.approval_status === "pending" ? "Request withdrawn" : "Request deleted");
      router.push("/projects");
      router.refresh();
    });
  };

  const setStatus = (status: ProjectStatus) => {
    if (
      status === "completed" &&
      !confirm("Mark this project completed? It becomes read-only for everyone.")
    ) {
      return;
    }
    return run(async () => {
      await apiFetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onProjectChange({ status });
      toast(status === "completed" ? "Project completed — now read-only" : "Project reopened");
      router.refresh();
    });
  };

  const errorLine = error && (
    <p role="alert" className="mt-2 text-sm text-red-700">
      {error}
    </p>
  );

  if (project.approval_status === "pending") {
    const nameOf = (id: number) => allUsers.find((u) => u.id === id)?.name ?? members.find((m) => m.user_id === id)?.name ?? "—";
    const onProject = new Set([...members.map((m) => m.user_id), ...added]);
    // The lead can be whoever asked for it, the admin approving, or anyone on the project.
    const leadChoices = [...new Set([project.requested_by, project.owner_id, currentUser.id, ...onProject].filter((x): x is number => x != null))];
    const addable = allUsers.filter((u) => !onProject.has(u.id));
    return (
      <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="font-semibold text-amber-900">Awaiting lead approval</h2>
        <p className="mt-1 text-sm text-amber-900/80">
          Requested by <strong>{project.requester_name ?? "—"}</strong>
          {project.requested_at && <> on {formatIst(project.requested_at)}</>}. Nominated
          lead: <strong>{project.owner_name ?? "—"}</strong>. The project is read-only until
          it is approved.
        </p>
        {rejecting && (
          <div className="mt-3">
            <label htmlFor="project-reject-reason" className="mb-1 block text-sm font-medium text-amber-900">
              Reason for rejecting <span className="text-red-600">*</span>
            </label>
            <textarea
              id="project-reject-reason"
              rows={2}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
        )}
        {staffing && isAdmin && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-900">Before you approve: who runs it, and who is on it</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">
                Project lead
                <select
                  value={leadId ?? ""}
                  onChange={(e) => setLeadId(Number(e.target.value) || null)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                >
                  {leadChoices.map((id) => (
                    <option key={id} value={id}>
                      {id === currentUser.id ? `${currentUser.name} (me)` : nameOf(id)}
                      {id === project.requested_by ? " — asked for it" : id === project.owner_id ? " — nominated on the request" : ""}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block font-normal text-slate-500">
                  The lead owns the project: they approve its tasks and sign them off. Add someone below to choose them here.
                </span>
              </label>
              <div>
                <label htmlFor="approve-add-member" className="block text-xs font-medium text-slate-700">
                  Members
                </label>
                <select
                  id="approve-add-member"
                  value=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (id) setAdded((a) => [...a, id]);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                >
                  <option value="">Add a member…</option>
                  {addable.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {members.map((m) => (
                    <li key={m.user_id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                      {m.name}
                    </li>
                  ))}
                  {added.map((id) => (
                    <li key={id} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-200">
                      {nameOf(id)}
                      <button
                        type="button"
                        aria-label={`Remove ${nameOf(id)}`}
                        onClick={() => {
                          setAdded((a) => a.filter((x) => x !== id));
                          if (leadId === id) setLeadId(project.requested_by ?? project.owner_id);
                        }}
                        className="text-emerald-600 hover:text-red-600"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => decide("approve")}
                disabled={busy || !leadId}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? "Approving…" : "Approve with this team"}
              </button>
              <button
                onClick={() => setStaffing(false)}
                disabled={busy}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {errorLine}
        <div className="mt-3 flex flex-wrap gap-2">
          {mayDecide && !rejecting && !staffing && (
            <>
              <button
                onClick={() => (isAdmin ? setStaffing(true) : decide("approve"))}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                Approve project
              </button>
              <button
                onClick={() => setRejecting(true)}
                disabled={busy}
                className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                Reject…
              </button>
            </>
          )}
          {mayDecide && rejecting && (
            <>
              <button
                onClick={() => decide("reject")}
                disabled={busy || !reason.trim()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                Reject request
              </button>
              <button
                onClick={() => setRejecting(false)}
                disabled={busy}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </>
          )}
          {isRequester && !rejecting && !staffing && (
            <button
              onClick={removeRequest}
              disabled={busy}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Withdraw request
            </button>
          )}
        </div>
      </section>
    );
  }

  if (project.approval_status === "rejected") {
    return (
      <section className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
        <h2 className="font-semibold text-red-900">Project request rejected</h2>
        <p className="mt-1 text-sm text-red-900/80">
          Rejected by <strong>{project.decider_name ?? "—"}</strong>
          {project.decided_at && <> on {formatIst(project.decided_at)}</>}
          {project.decision_note && <>: “{project.decision_note}”</>}. The project is
          read-only.
        </p>
        {errorLine}
        {(isRequester || isAdmin) && (
          <button
            onClick={removeRequest}
            disabled={busy}
            className="mt-3 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
          >
            Delete request
          </button>
        )}
      </section>
    );
  }

  if (project.status === "completed") {
    return (
      <section className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <h2 className="font-semibold text-emerald-900">
          <span aria-hidden="true">🔒 </span>Project completed — read-only
        </h2>
        <p className="mt-1 text-sm text-emerald-900/80">
          Tasks, requests, members, milestones and settings can no longer be changed.
          Task PDFs and exports are still available.
        </p>
        {errorLine}
        {isAdmin && (
          <button
            onClick={() => setStatus("active")}
            disabled={busy}
            className="mt-3 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
          >
            Reopen project
          </button>
        )}
      </section>
    );
  }

  if (readyToComplete && canManage) {
    return (
      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
        <div>
          <h2 className="font-semibold text-indigo-900">All tasks are signed off</h2>
          <p className="text-sm text-indigo-900/80">
            Mark the project completed to make everything read-only.
          </p>
          {errorLine}
        </div>
        <button
          onClick={() => setStatus("completed")}
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          Mark completed
        </button>
      </section>
    );
  }

  return null;
}
