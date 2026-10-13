"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { isInlineImage } from "@/lib/inline-files";

/**
 * Everything filed under a project, in one place.
 *
 * Files arrive on the project and on its tasks, and nobody remembers which
 * task someone attached the drawing to. This is the shelf: pictures as
 * pictures, documents as documents, each saying where it came from and
 * linking back to the task it belongs to.
 *
 * New files added here land on the project. One that belongs to a particular
 * task is still attached from that task, where it has context.
 */

export interface ProjectFile {
  id: number;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
  uploaded_by: number | null;
  uploader_name: string | null;
  kind: "project" | "task";
  task_id: number | null;
  task_title: string | null;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The download URL for a file, whichever shelf it sits on. */
function hrefOf(f: ProjectFile, inline = false): string {
  const base =
    f.kind === "project"
      ? `/api/project-attachments/${f.id}`
      : `/api/attachments/${f.id}`;
  return inline ? `${base}?inline=1` : base;
}

/** What a non-image is, in one short word on a tile. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "FILE";
  return filename.slice(dot + 1).toUpperCase().slice(0, 4);
}

type Filter = "all" | "images" | "documents";

export default function ProjectGallery({
  projectId,
  currentUserId,
  canManage,
  readOnly,
}: {
  projectId: number;
  currentUserId: number;
  canManage: boolean;
  readOnly: boolean;
}) {
  const { toast } = useToast();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<ProjectFile | null>(null);

  useEffect(() => {
    let live = true;
    apiFetch<{ files: ProjectFile[] }>(`/api/projects/${projectId}/files`)
      .then((r) => live && setFiles(r.files))
      .catch(() => live && setFiles([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [projectId]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      const isImage = isInlineImage(f.mime_type);
      if (filter === "images" && !isImage) return false;
      if (filter === "documents" && isImage) return false;
      if (!q) return true;
      return (
        f.filename.toLowerCase().includes(q) ||
        (f.task_title ?? "").toLowerCase().includes(q) ||
        (f.uploader_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [files, filter, search]);

  const imageCount = files.filter((f) => isInlineImage(f.mime_type)).length;

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch<{
        attachment: Omit<ProjectFile, "kind" | "task_id" | "task_title">;
      }>(`/api/projects/${projectId}/attachments`, { method: "POST", body });
      setFiles((prev) => [
        { ...res.attachment, kind: "project", task_id: null, task_title: null },
        ...prev,
      ]);
      toast("Added to the gallery");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add that file", "error");
    } finally {
      setUploading(false);
    }
  }

  async function remove(f: ProjectFile) {
    if (!confirm(`Remove ${f.filename}?`)) return;
    try {
      await apiFetch(hrefOf(f), { method: "DELETE" });
      setFiles((prev) => prev.filter((x) => !(x.id === f.id && x.kind === f.kind)));
      if (viewing && viewing.id === f.id && viewing.kind === f.kind) setViewing(null);
      toast("Removed");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove it", "error");
    }
  }

  const mayRemove = (f: ProjectFile) =>
    !readOnly && (canManage || f.uploaded_by === currentUserId);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">
          Gallery{" "}
          <span className="figure font-normal text-slate-600">({files.length})</span>
        </h2>
        <p className="text-xs text-slate-600">
          Everything attached to this project and its tasks.
        </p>
      </div>

      {files.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Filter files"
            className="inline-flex rounded-lg bg-slate-100 p-0.5"
          >
            {(
              [
                ["all", `All ${files.length}`],
                ["images", `Pictures ${imageCount}`],
                ["documents", `Documents ${files.length - imageCount}`],
              ] as [Filter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  filter === key
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            aria-label="Search files"
            className="min-w-40 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
      )}

      {loading ? (
        <p className="py-6 text-center text-sm text-slate-600">Loading…</p>
      ) : files.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600">
          Nothing filed yet. Drawings, briefs and photographs put here — or on any
          task — show up in this gallery.
        </p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-600">Nothing matches that.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((f) => {
            const isImage = isInlineImage(f.mime_type);
            return (
              <li
                key={`${f.kind}-${f.id}`}
                className="group relative overflow-hidden rounded-xl ring-1 ring-slate-200"
              >
                {isImage ? (
                  <button
                    type="button"
                    onClick={() => setViewing(f)}
                    className="block w-full"
                    aria-label={`View ${f.filename}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={hrefOf(f, true)}
                      alt={f.filename}
                      loading="lazy"
                      className="h-28 w-full bg-slate-50 object-cover transition group-hover:opacity-90"
                    />
                  </button>
                ) : (
                  <a
                    href={hrefOf(f)}
                    className="flex h-28 w-full flex-col items-center justify-center gap-1 bg-slate-50 transition group-hover:bg-slate-100"
                  >
                    <span aria-hidden="true" className="text-2xl">
                      📄
                    </span>
                    <span className="figure text-xs font-semibold text-slate-600">
                      {extensionOf(f.filename)}
                    </span>
                  </a>
                )}

                <div className="p-2">
                  <a
                    href={hrefOf(f)}
                    className="block truncate text-xs font-medium text-indigo-600 hover:underline"
                    title={f.filename}
                  >
                    {f.filename}
                  </a>
                  <div className="mt-0.5 truncate text-[11px] text-slate-600">
                    {fileSize(Number(f.size_bytes))}
                    {f.uploader_name ? ` · ${f.uploader_name}` : ""}
                  </div>
                  {f.kind === "task" && f.task_id ? (
                    <Link
                      href={`/projects/${projectId}?task=${f.task_id}`}
                      className="mt-0.5 block truncate text-[11px] text-slate-600 hover:text-indigo-600 hover:underline"
                      title={f.task_title ?? ""}
                    >
                      from {f.task_title}
                    </Link>
                  ) : (
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      on the project
                    </div>
                  )}
                </div>

                {mayRemove(f) && (
                  <button
                    type="button"
                    onClick={() => remove(f)}
                    aria-label={`Remove ${f.filename}`}
                    className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 text-sm text-slate-600 opacity-0 ring-1 ring-slate-200 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {uploading ? "Uploading…" : "+ Add to gallery"}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-xs text-slate-600">
            Max 10 MB. Files added here belong to the project.
          </span>
        </div>
      )}

      {viewing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={viewing.filename}
          onClick={() => setViewing(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white"
          >
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5">
              <span className="truncate text-sm font-medium text-slate-800">
                {viewing.filename}
              </span>
              <a
                href={hrefOf(viewing)}
                className="ml-auto shrink-0 text-sm font-medium text-indigo-600 hover:underline"
              >
                Download
              </a>
              <button
                type="button"
                onClick={() => setViewing(null)}
                aria-label="Close"
                className="shrink-0 rounded px-2 text-slate-600 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hrefOf(viewing, true)}
              alt={viewing.filename}
              className="max-h-[75vh] w-full bg-slate-50 object-contain"
            />
          </div>
        </div>
      )}
    </section>
  );
}
