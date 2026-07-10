"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";

interface Issue {
  row: number;
  message: string;
  skipped: boolean;
}

export default function ImportTasksModal({
  open,
  onClose,
  projectId,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; issues: Issue[] } | null>(
    null
  );
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/tasks/import`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult({ created: data.created ?? 0, issues: data.issues ?? [] });
      if ((data.created ?? 0) > 0) {
        toast(`Imported ${data.created} task(s)`);
        onImported();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setFile(null);
    setResult(null);
    setError("");
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title="Import tasks from Excel" widthClass="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <p className="text-sm text-slate-500">
          Upload an <strong>.xlsx</strong> file using the{" "}
          <a
            href={`/api/projects/${projectId}/tasks/template`}
            className="text-indigo-600 hover:underline"
          >
            task template
          </a>
          . Columns: Title, Description, Status, Priority, Assignee Employee ID,
          Due Date, Estimated Hours.
        </p>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
        />

        {result && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-medium text-green-700">
              ✓ Created {result.created} task(s)
            </p>
            {result.issues.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
                {result.issues.map((i, idx) => (
                  <li
                    key={idx}
                    className={i.skipped ? "text-red-600" : "text-amber-600"}
                  >
                    Row {i.row}: {i.message}
                    {i.skipped ? " (skipped)" : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            {result ? "Done" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={busy || !file}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
