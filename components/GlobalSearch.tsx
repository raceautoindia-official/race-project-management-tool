"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/types";

interface ProjectHit {
  id: number;
  name: string;
  status: string;
}
interface TaskHit {
  id: number;
  title: string;
  status: TaskStatus;
  project_id: number;
  project_name: string;
}

export default function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [projects, setProjects] = useState<ProjectHit[]>([]);
  const [tasks, setTasks] = useState<TaskHit[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let active = true;
    const t = setTimeout(async () => {
      try {
        const d = await apiFetch<{ projects: ProjectHit[]; tasks: TaskHit[] }>(
          `/api/search?q=${encodeURIComponent(q.trim())}`
        );
        if (active) {
          setProjects(d.projects);
          setTasks(d.tasks);
        }
      } catch {
        // ignore
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQ("");
    router.push(href);
  }

  const show = open && q.trim().length >= 2;
  const empty = projects.length === 0 && tasks.length === 0;

  return (
    <div className="relative w-full max-w-xs" ref={ref}>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search projects & tasks…"
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {show && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {empty ? (
            <p className="px-4 py-3 text-sm text-slate-400">No matches.</p>
          ) : (
            <>
              {projects.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Projects
                  </div>
                  {projects.map((p) => (
                    <button
                      key={`p${p.id}`}
                      onClick={() => go(`/projects/${p.id}`)}
                      className="block w-full truncate px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      ▢ {p.name}
                    </button>
                  ))}
                </div>
              )}
              {tasks.length > 0 && (
                <div className="border-t border-slate-100">
                  <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Tasks
                  </div>
                  {tasks.map((t) => (
                    <button
                      key={`t${t.id}`}
                      onClick={() => go(`/projects/${t.project_id}`)}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="truncate text-slate-700">✓ {t.title}</span>
                      <span className="ml-1 text-xs text-slate-400">
                        — {t.project_name} · {TASK_STATUS_LABELS[t.status]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
