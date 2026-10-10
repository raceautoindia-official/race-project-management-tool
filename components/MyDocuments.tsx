"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatRelative } from "@/lib/format";

export interface PersonalDocument {
  id: number;
  user_id: number;
  category: string;
  note: string | null;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
  user_name?: string;
}

export const CATEGORY_LABELS: Record<string, string> = {
  id_proof: "ID proof",
  address_proof: "Address proof",
  qualification: "Qualification",
  bank: "Bank details",
  contract: "Contract",
  other: "Other",
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Someone's own documents: ID proof, certificates, a signed contract.
 *
 * Theirs to add and remove. An admin can open them from the admin side, and
 * that is recorded — which is why the notice below says so plainly rather
 * than leaving people to assume one way or the other.
 */
export default function MyDocuments({ initial }: { initial: PersonalDocument[] }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState(initial);
  const [category, setCategory] = useState("id_proof");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("category", category);
      form.append("note", note.trim());
      const res = await apiFetch<{ document: PersonalDocument }>("/api/documents", {
        method: "POST",
        body: form,
      });
      setDocs((prev) => [res.document, ...prev]);
      setNote("");
      toast("Uploaded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function remove(doc: PersonalDocument) {
    if (!confirm(`Remove "${doc.filename}"?`)) return;
    try {
      await apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      toast("Removed");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove it", "error");
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">
        Your own documents — ID proof, certificates, a signed contract. Yours to add
        and remove. <strong>An administrator can open them</strong>, and the activity
        log records when they do.
      </p>

      {error && (
        <div role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="doc-category" className="mb-1 block text-xs font-medium text-slate-600">
            What is it?
          </label>
          <select
            id="doc-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="doc-note" className="mb-1 block text-xs font-medium text-slate-600">
            Note <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id="doc-note"
            value={note}
            maxLength={255}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Aadhaar, front and back"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <label className="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          {uploading ? "Uploading…" : "+ Upload"}
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            aria-label="Choose a document to upload"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
        </label>
        <span className="pb-2 text-xs text-slate-500">Max 10 MB</span>
      </div>

      {docs.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          You have not uploaded anything yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{d.filename}</p>
                <p className="text-xs text-slate-500">
                  {CATEGORY_LABELS[d.category] ?? d.category}
                  {d.note ? ` · ${d.note}` : ""} · {fmtBytes(d.size_bytes)} ·{" "}
                  {formatRelative(d.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <a
                  href={`/api/documents/${d.id}`}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Download
                </a>
                <button
                  onClick={() => remove(d)}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
