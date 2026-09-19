"use client";

import { useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import AddToCalendar from "@/components/AddToCalendar";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatIst, istInputToUtc } from "@/lib/tz";
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

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

const REMINDER_OPTIONS: { label: string; value: string }[] = [
  { label: "No reminder", value: "" },
  { label: "10 minutes before", value: "10" },
  { label: "30 minutes before", value: "30" },
  { label: "1 hour before", value: "60" },
  { label: "3 hours before", value: "180" },
  { label: "1 day before", value: "1440" },
];

function fmt(dt: string): string {
  // dt is "YYYY-MM-DD HH:MM:SS" (stored UTC). Render in IST.
  return formatIst(dt);
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

/** End time as a stored-style UTC string, from the start plus its duration. */
function endOf(m: Meeting): string {
  const start = new Date(`${m.start_time.replace(" ", "T")}Z`);
  const end = new Date(start.getTime() + (m.duration_minutes ?? 30) * 60_000);
  return end.toISOString().replace("T", " ").slice(0, 19);
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
      <h2 className="mb-2 text-sm font-semibold text-slate-600">{title}</h2>
      {meetings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          {empty}
        </div>
      ) : (
        <div className="space-y-3">
          {meetings.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border border-slate-200 p-4 ${
                muted ? "bg-slate-50" : "bg-white"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{m.title}</div>
                  <div className="mt-0.5 text-sm text-indigo-600">
                    {fmt(m.start_time)}
                    {m.reminder_minutes != null && (
                      <span className="ml-2 text-xs text-slate-500">
                        🔔 {m.reminder_minutes}m before
                      </span>
                    )}
                    {m.recurrence && m.recurrence !== "none" && (
                      <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs capitalize text-indigo-600">
                        🔁 {m.recurrence}
                      </span>
                    )}
                  </div>
                  {m.description && (
                    <p className="mt-1 text-sm text-slate-600">{m.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    {m.location && <span>📍 {m.location}</span>}
                    {m.project_name && (
                      <Link
                        href={`/projects/${m.project_id}`}
                        className="inline-block py-1 hover:text-indigo-600"
                      >
                        📁 {m.project_name}
                      </Link>
                    )}
                    {m.creator_name && <span>by {m.creator_name}</span>}
                  </div>
                  {m.attendees && m.attendees.length > 0 && (
                    <div className="mt-1 text-xs text-slate-500">
                      Attendees: {m.attendees.map((a) => a.name).join(", ")}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-start gap-2">
                  {m.video_url && (
                    <a
                      href={m.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      🎥 Join video call
                    </a>
                  )}
                  <AddToCalendar
                    compact
                    title={m.title}
                    start={m.start_time}
                    end={endOf(m)}
                    details={m.description}
                    location={m.video_url ?? m.location}
                    icsHref={`/api/meetings/${m.id}/ics`}
                  />
                  {canDelete(m) && (
                    <button
                      onClick={() => onDelete(m)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
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
  const [duration, setDuration] = useState("30");
  const [video, setVideo] = useState<"none" | "room" | "link">("room");
  const [videoUrl, setVideoUrl] = useState("");
  const [recurrence, setRecurrence] = useState("none");
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
      const res = await apiFetch<{ meeting: Meeting; videoWarning?: string | null }>("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          projectId: projectId === "" ? null : Number(projectId),
          location,
          startTime: istInputToUtc(startTime),
          reminderMinutes: reminder === "" ? null : Number(reminder),
          durationMinutes: Number(duration),
          video,
          videoUrl: video === "link" ? videoUrl.trim() : null,
          recurrence,
          attendeeIds,
        }),
      });
      onCreated(res.meeting);
      toast("Meeting scheduled");
      if (res.videoWarning) toast(res.videoWarning, "error");
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
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div>
          <label htmlFor="meeting-title" className="mb-1 block text-sm font-medium text-slate-700">
            Title
          </label>
          <input
            id="meeting-title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="meeting-description" className="mb-1 block text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            id="meeting-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="meeting-start" className="mb-1 block text-sm font-medium text-slate-700">Start</label>
            <input
              id="meeting-start"
              type="datetime-local"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="meeting-duration" className="mb-1 block text-sm font-medium text-slate-700">Duration</label>
            <select id="meeting-duration" value={duration} onChange={(e) => setDuration(e.target.value)} className={inputClass}>
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d < 60 ? `${d} minutes` : `${d / 60} hour${d > 60 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="meeting-reminder" className="mb-1 block text-sm font-medium text-slate-700">Reminder</label>
            <select id="meeting-reminder" value={reminder} onChange={(e) => setReminder(e.target.value)} className={inputClass}>
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="meeting-repeat" className="mb-1 block text-sm font-medium text-slate-700">Repeat</label>
            <select id="meeting-repeat" value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={inputClass}>
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label htmlFor="meeting-project" className="mb-1 block text-sm font-medium text-slate-700">
              Project (optional)
            </label>
            <select id="meeting-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="meeting-location" className="mb-1 block text-sm font-medium text-slate-700">
              Location / link
            </label>
            <input
              id="meeting-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={inputClass}
              placeholder="Room 2 / https://…"
            />
          </div>
        </div>
        <div>
          <label htmlFor="meeting-video" className="mb-1 block text-sm font-medium text-slate-700">
            Video call
          </label>
          <select
            id="meeting-video"
            value={video}
            onChange={(e) => setVideo(e.target.value as "none" | "room" | "link")}
            className={inputClass}
          >
            <option value="room">Create a room in our meetings app</option>
            <option value="link">Use a link I already have</option>
            <option value="none">No video call</option>
          </select>
          {video === "link" && (
            <input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              required
              placeholder="https://…"
              aria-label="Meeting link"
              className={`${inputClass} mt-2`}
            />
          )}
          {video === "room" && (
            <p className="mt-1 text-xs text-slate-500">
              Everyone gets a join link. They sign in to the meetings app once.
            </p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Attendees</label>
          <div tabIndex={0} className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
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
          <p className="mt-1 text-xs text-slate-500">
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
