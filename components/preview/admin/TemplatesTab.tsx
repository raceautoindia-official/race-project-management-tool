"use client";

// Templates: ready-made outlines a new project can start from. Using one is
// live in the preview; creating and editing templates needs the backend.

import { useState } from "react";
import { usePreview } from "@/lib/preview/store";
import { Button, ButtonLink, Card, EmptyState, NotConnectedTag, SectionTitle, useNotConnected } from "@/components/preview/ui";
import { HelpText } from "./shared";

export default function TemplatesTab() {
  const { state, terms } = usePreview();
  const notConnected = useNotConnected();
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const t = terms.task;
  const s = terms.subtask;

  return (
    <div>
      <SectionTitle
        count={state.templates.length}
        action={
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline"><NotConnectedTag /></span>
            <Button onClick={notConnected("Create template")}>+ Create template</Button>
          </div>
        }
      >
        Templates
      </SectionTitle>
      <HelpText>
        Start a new {terms.project.one.toLowerCase()} from a ready-made outline of {t.many.toLowerCase()} and {s.many.toLowerCase()}, then adjust it.
        Owners and dates are filled in when you use it.
      </HelpText>

      {state.templates.length === 0 ? (
        <EmptyState icon="📋" title="No templates yet" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {state.templates.map((tpl) => {
            const subCount = tpl.tasks.reduce((n, x) => n + x.subtasks.length, 0);
            const expanded = open.has(tpl.id);
            return (
              <Card key={tpl.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900">{tpl.name}</h3>
                    <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{tpl.industry}</span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-slate-600">{tpl.description}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {tpl.tasks.length} {(tpl.tasks.length === 1 ? t.one : t.many).toLowerCase()} · {subCount} {(subCount === 1 ? s.one : s.many).toLowerCase()}
                </p>

                <button
                  type="button"
                  onClick={() => toggle(tpl.id)}
                  aria-expanded={expanded}
                  className="mt-3 self-start text-sm font-medium text-indigo-600 hover:underline"
                >
                  {expanded ? "▾ Hide outline" : "▸ Show outline"}
                </button>
                {expanded && (
                  <ol className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                    {tpl.tasks.map((task, i) => (
                      <li key={i}>
                        <div className="font-medium text-slate-800">{i + 1}. {task.title}</div>
                        <ul className="ml-5 mt-1 list-disc space-y-0.5 text-slate-600 marker:text-slate-300">
                          {task.subtasks.map((st, j) => <li key={j}>{st}</li>)}
                        </ul>
                      </li>
                    ))}
                  </ol>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                  <ButtonLink href={`/preview/projects?new=1&template=${tpl.id}`}>Use template</ButtonLink>
                  <Button variant="secondary" onClick={notConnected("Edit template")}>Edit</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
