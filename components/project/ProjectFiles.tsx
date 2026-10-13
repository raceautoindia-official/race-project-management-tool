"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";

/**
 * The files a project starts from — the brief, a drawing, the customer's
 * email — as opposed to the ones hanging off a particular task.
 *
 * Attached while the project is being created, and added to afterwards:
 * a project goes on acquiring paperwork long after it begins.
 */

interface ProjectFile {
  id: number;
  filename: string;
  size_bytes: number;
  uploaded_by: number | null;
  uploader_name: string | null;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectFiles({
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
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch<{ attachments: ProjectFile[] }>(`/api/projects/${projectId}/attachments`)
      .then((r) => live && setFiles(r.attachments))
      .catch(() => live && setFiles([]));
    return () => {
      live = false;
    };
  }, [projectId]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch<{ attachment: ProjectFile }>(
        `/api/projects/${projectId}/attachments`,
        { method: "POST", body }
      );
      setFiles((prev) => [res.attachment, ...prev]);
      toast("Attached");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not attach that file", "error");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Remove this file from the project?")) return;
    try {
      await apiFetch(`/api/project-attachments/${id}`, { method: "DELETE" });
      setFiles((prev) => prev.filter((f) => f.id !== id));
      toast("Removed");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove it", "error");
    }
  }

  // Nothing here and nothing to add: do not take up a section saying so.
  if (files.length === 0 && readOnly) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">
        Project files ({files.length})
      </h2>
      {files.length > 0 && (
        <ul className="mb-3 space-y-1">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm"
            >
              <span aria-hidden="true" className="text-slate-500">
                📎
              </span>
              <a
                href={`/api/project-attachments/${f.id}`}
                className="truncate font-medium text-indigo-600 hover:underline"
              >
                {f.filename}
              </a>
              <span className="shrink-0 text-xs text-slate-600">
                {fileSize(Number(f.size_bytes))}
                {f.uploader_name ? ` · ${f.uploader_name}` : ""}
              </span>
              {!readOnly && (canManage || f.uploaded_by === currentUserId) && (
                <button
                  onClick={() => remove(f.id)}
                  aria-label={`Remove ${f.filename}`}
                  className="ml-auto shrink-0 rounded px-1 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {uploading ? "Uploading…" : "+ Attach file"}
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
          <span className="text-xs text-slate-600">Max 10 MB</span>
        </div>
      )}
    </section>
  );
}
