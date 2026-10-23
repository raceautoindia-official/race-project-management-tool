"use client";

// Activity log: a company-wide audit trail of the most recent changes.

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePreview } from "@/lib/preview/store";
import { Button, Card, EmptyState, NotConnectedTag, PersonChip, SectionTitle, inputCls, timeAgo, useNotConnected } from "@/components/preview/ui";
import { HelpText } from "./shared";

const LIMIT = 50;

export default function ActivityTab() {
  const { state, terms } = usePreview();
  const notConnected = useNotConnected();
  const [projectId, setProjectId] = useState("");

  const entries = useMemo(
    () =>
      state.activity
        .filter((a) => !projectId || a.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, LIMIT),
    [state.activity, projectId],
  );
  const projectName = (id: string) => state.projects.find((p) => p.id === id)?.name ?? `Deleted ${terms.project.one.toLowerCase()}`;

  return (
    <div>
      <SectionTitle
        action={
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline"><NotConnectedTag /></span>
            <Button variant="secondary" onClick={notConnected("Export activity as CSV")}>⤓ Export CSV</Button>
          </div>
        }
      >
        Activity log
      </SectionTitle>
      <HelpText>The latest {LIMIT} changes across every {terms.project.one.toLowerCase()} — who did what, and when.</HelpText>

      <div className="mb-3">
        <select aria-label={`Filter by ${terms.project.one.toLowerCase()}`} className={`${inputCls} sm:max-w-xs`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All {terms.project.many.toLowerCase()}</option>
          {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon="🕘" title="No activity yet" body={`Changes will show up here as people work on ${terms.project.many.toLowerCase()}.`} />
      ) : (
        <Card className="divide-y divide-slate-100">
          {entries.map((a) => (
            <div key={a.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
              <div className="shrink-0 sm:w-40"><PersonChip id={a.actorId} /></div>
              <div className="min-w-0 flex-1 text-sm">
                <span className="text-slate-700">{a.text}</span>
                <div className="mt-0.5 text-xs text-slate-500">
                  in{" "}
                  <Link href={`/preview/projects/${a.projectId}`} className="font-medium text-indigo-600 hover:underline">
                    {projectName(a.projectId)}
                  </Link>
                </div>
              </div>
              <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString("en-IN")} className="shrink-0 text-xs text-slate-400">
                {timeAgo(a.createdAt)}
              </time>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
