"use client";

import { useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import type { Meeting, Role } from "@/lib/types";

interface PickUser {
  id: number;
  name: string;
  email: string;
}
interface PickProject {
  id: number;
  name: string;
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

const REMINDER_OPTIONS: { label: string; value: string }[] = [
  { label: "No reminder", value: "" },
  { label: "10 minutes before", value: "10" },
  { label: "30 minutes before", value: "30" },
  { label: "1 hour before", value: "60" },
  { label: "3 hours before", value: "180" },
  { label: "1 day before", value: "1440" },
];

function fmt(dt: string): string {
  // dt is "YYYY-MM-DD HH:MM:SS" (stored UTC). Render compactly.
  const [d, t] = dt.replace("T", " ").split(" ");
  return `${d} ${t ? t.slice(0, 5) : ""}`.trim();
}

export default function MeetingsView({
  initial,
  users,
  projects,
  currentUser,
}: {
  initial: Meeting[];
  users: PickUser[];
  projects: PickProject[];
  currentUser: { id: number; role: Role };
}) {
  const { toast } = useToast();
  const [meetings, setMeetings] = useState<Meeting[]>(initial);
  const [open, setOpen] = useState(false);

  const now = isoNow();
  const upcoming = meetings.filter((m) => m.start_time >= now);
  const past = meetings.filter((m) => m.start_time < now);

  function canDelete(m: Meeting) {
    return currentUser.role === "admin" || m.created_by === currentUser.id;
  }

  async function remove(m: Meeting) {
    if (!confirm(`Cancel meeting "${m.title}"?`)) return;
    try {
      await apiFetch(`/api/meetings/${m.id}`, { method: "DELETE" });
      setMeetings((ms) => ms.filter((x) => x.id !== m.id));
      toast("Meeting cancelled");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not cancel", "error");
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          + New meeting
        </button>
      </div>

      <Section title="Upcoming" meetings={upcoming} canDelete={canDelete} onDelete={remove} empty="No upcoming meetings." />
      {past.length > 0 && (
        <div className="mt-6">
          <Section title="Past" meetings={past} canDelete={canDelete} onDelete={remove} muted />
        </div>
      )}

      {open && (
        <NewMeetingModal
          users={users}
          projects={projects}
          onClose={() => setOpen(false)}
          onCreated={(m) => {
            setMeetings((ms) =>
              [...ms, m].sort((a, b) => a.start_time.localeCompare(b.start_time))
            );
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function isoNow(): string {
  // Build a "YYYY-MM-DD HH:MM:SS" in UTC to compare with stored values.
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function Section({
  title,
  meetings,
  canDelete,
  onDelete,
  empty,
  muted,
}: {
  title: string;
  meetings: Meeting[];
  canDelete: (m: Meeting) => boolean;
  onDelete: (m: Meeting) => void;
  empty?: string;
  muted?: boolean;
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-500">{title}</h2>
      {meetings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          {empty}
        </div>
      ) : (
        <div className="space-y-3">
          {meetings.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border border-slate-200 bg-white p-4 ${
                muted ? "opacity-70" : ""
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{m.title}</div>
                  <div className="mt-0.5 text-sm text-indigo-600">
                    {fmt(m.start_time)}
                    {m.reminder_minutes != null && (
                      <span className="ml-2 text-xs text-slate-400">
                        🔔 {m.reminder_minutes}m before
                      </span>
                    )}
                  </div>
                  {m.description && (
                    <p className="mt-1 text-sm text-slate-600">{m.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                    {m.location && <span>📍 {m.location}</span>}
                    {m.project_name && (
                      <Link
                        href={`/projects/${m.project_id}`}
                        className="hover:text-indigo-600"
                      >
                        📁 {m.project_name}
                      </Link>
                    )}
                    {m.creator_name && <span>by {m.creator_name}</span>}
                  </div>
                  {m.attendees && m.attendees.length > 0 && (
                    <div className="mt-1 text-xs text-slate-400">
                      Attendees: {m.attendees.map((a) => a.name).join(", ")}
                    </div>
                  )}
                </div>
                {canDelete(m) && (
                  <button
                    onClick={() => onDelete(m)}
                    className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewMeetingModal({
  users,
  projects,
  onClose,
  onCreated,
}: {
  users: PickUser[];
  projects: PickProject[];
  onClose: () => void;
  onCreated: (m: Meeting) => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState("");
  const [reminder, setReminder] = useState("");
  const [attendeeIds, setAttendeeIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(id: number) {
    setAttendeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await apiFetch<{ meeting: Meeting }>("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          projectId: projectId === "" ? null : Number(projectId),
          location,
          startTime,
          reminderMinutes: reminder === "" ? null : Number(reminder),
          attendeeIds,
        }),
      });
      onCreated(res.meeting);
      toast("Meeting scheduled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New meeting" widthClass="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Title</label>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Start</label>
            <input
              type="datetime-local"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Reminder</label>
            <select value={reminder} onChange={(e) => setReminder(e.target.value)} className={inputClass}>
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Project (optional)
            </label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Location / link
            </label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} placeholder="Room 2 / https://…" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Attendees</label>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {users.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm">
                <input
                  type="checkbox"
                  checked={attendeeIds.includes(u.id)}
                  onChange={() => toggle(u.id)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                {u.name}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            You are added automatically as the organizer.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {busy ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
