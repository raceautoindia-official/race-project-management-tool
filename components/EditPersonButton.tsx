"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { DepartmentSelect } from "@/components/DepartmentField";

/**
 * The two things about a person that this app decides for itself.
 *
 * Their name, employee ID, role and whether they still work here all come
 * from the Attendance app and are read-only. A job title has no column there
 * at all, so PM keeps its own. A department does exist there, but with gaps
 * and wrong values, so an admin can set one here and it stops being
 * overwritten — and clearing it hands the person back to Attendance.
 */
export default function EditPersonButton({
  userId,
  name,
  department,
  departmentSource,
  designation,
}: {
  userId: number;
  name: string;
  department: string | null;
  departmentSource: "attendance" | "pm";
  designation: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [dept, setDept] = useState(department ?? "");
  const [title, setTitle] = useState(designation ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ department: dept, designation: title }),
      });
      setOpen(false);
      toast(`${name} updated`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Edit
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Edit ${name}`}>
        <form onSubmit={save} className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor={`designation-${userId}`}
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Job title
            </label>
            <input
              id={`designation-${userId}`}
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Design Engineer"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-slate-600">
              Kept here. The Attendance app has no job title to copy.
            </p>
          </div>

          <div>
            <DepartmentSelect
              id={`department-${userId}`}
              value={dept}
              onChange={setDept}
              hint={
                departmentSource === "pm"
                  ? "Set here. Clear it to follow the Attendance app again."
                  : "Follows the Attendance app. Setting one here overrides it."
              }
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
