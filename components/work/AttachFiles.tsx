"use client";

import { useId, useRef } from "react";

const MAX_BYTES = 10 * 1024 * 1024; // the server's limit (lib/attachments.ts)

/**
 * "Attach files" for the send-back dialogs: pick one or more files, see them
 * listed, drop any again. The parent keeps the list and uploads it with
 * uploadFiles() once the note has gone through.
 */
export function FilesField({
  files,
  onChange,
  hint = "Optional — e.g. a marked-up drawing or a screenshot of what to fix. Up to 10 MB each.",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  hint?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const tooBig = files.filter((f) => f.size > MAX_BYTES);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={id}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/60 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
        >
          <span aria-hidden>📎</span> Attach files
        </label>
        <input
          ref={input}
          id={id}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length) onChange([...files, ...picked]);
            if (input.current) input.current.value = "";
          }}
        />
        <span className="text-xs text-slate-500">{hint}</span>
      </div>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ring-1 ring-inset ${
                f.size > MAX_BYTES ? "bg-red-50 text-red-700 ring-red-200" : "bg-slate-50 text-slate-700 ring-slate-200"
              }`}
            >
              <span className="min-w-0 truncate">
                📄 {f.name} <span className="text-slate-400">· {sizeLabel(f.size)}</span>
                {f.size > MAX_BYTES && " — too large (max 10 MB)"}
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="shrink-0 rounded px-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {tooBig.length > 0 && <p className="mt-1 text-xs text-red-600">Remove the files over 10 MB to send.</p>}
    </div>
  );
}

/** True when every picked file is within the limit. */
export function filesOk(files: File[]): boolean {
  return files.every((f) => f.size > 0 && f.size <= MAX_BYTES);
}

/** The note as sent, naming the files so the notification mentions them. */
export function noteWithFiles(note: string, files: File[]): string {
  if (!files.length) return note;
  return `${note}\n📎 ${files.map((f) => f.name).join(", ")}`.slice(0, 1000);
}

/**
 * Upload each file to `url` (POST multipart 'file'). Returns the names that
 * failed, so the caller can say so — the note itself has already been sent.
 */
export async function uploadFiles(url: string, files: File[]): Promise<string[]> {
  const failed: string[] = [];
  for (const f of files) {
    const body = new FormData();
    body.append("file", f);
    try {
      const res = await fetch(url, { method: "POST", body });
      if (!res.ok) failed.push(f.name);
    } catch {
      failed.push(f.name);
    }
  }
  return failed;
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Download links for files already attached (a subtask's, a task's, a request's). */
export function FileLinks({
  files,
  base = "/api/attachments",
}: {
  files: { id: number; filename: string; size_bytes: number; uploader_name?: string | null }[];
  /** Where each file downloads from; a request's files have their own route. */
  base?: string;
}) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((a) => (
        <li key={a.id}>
          <a
            href={`${base}/${a.id}`}
            className="inline-flex max-w-xs items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs text-indigo-700 ring-1 ring-inset ring-indigo-200 hover:bg-indigo-50"
            title={a.uploader_name ? `Added by ${a.uploader_name}` : undefined}
          >
            <span aria-hidden>📄</span>
            <span className="truncate">{a.filename}</span>
            <span className="shrink-0 text-slate-400">{sizeLabel(Number(a.size_bytes))}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
