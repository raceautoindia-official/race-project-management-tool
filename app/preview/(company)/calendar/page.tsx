"use client";

// Calendar: due dates, meetings and personal reminders in one place. Meetings
// and reminders can be added locally; sending email/push reminders needs the
// backend.

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import Modal from "@/components/Modal";
import { usePreview } from "@/lib/preview/store";
import { isOverdue, itemLink, projectById, todayISO } from "@/lib/preview/engine";
import type { Meeting, Reminder, StatusCategory } from "@/lib/preview/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  NotConnectedTag,
  PageHeader,
  PersonChip,
  StatusPill,
  fmtDate,
  inputCls,
} from "@/components/preview/ui";

type Kind = "work" | "meeting" | "reminder";

interface Entry {
  key: string;
  kind: Kind;
  date: string;
  time?: string;
  title: string;
  sub?: string;
  href?: string;
  overdue: boolean;
  closed: boolean;
  status?: StatusCategory;
  meeting?: Meeting;
  reminder?: Reminder;
}

const KIND: Record<Kind, { label: string; dot: string; chip: string }> = {
  work: { label: "Due dates", dot: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-800 hover:bg-indigo-100" },
  meeting: { label: "Meetings", dot: "bg-teal-500", chip: "bg-teal-50 text-teal-800 hover:bg-teal-100" },
  reminder: { label: "Reminders", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-900 hover:bg-amber-100" },
};
const OVERDUE_CHIP = "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const REMINDER_CATEGORIES = ["General", "Payment", "Renewal", "Compliance", "Follow-up"];

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export default function CalendarPage() {
  const { state, me, terms } = usePreview();
  const today = todayISO();

  const [cursor, setCursor] = useState(() => startOfMonth(parseISO(today)));
  // The preview store only renders on the client, so window is available here.
  const [view, setView] = useState<"month" | "list">(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches ? "month" : "list"
  );
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [show, setShow] = useState<Record<Kind, boolean>>({ work: true, meeting: true, reminder: true });
  const [selectedDay, setSelectedDay] = useState<string>(today);
  const [newMeeting, setNewMeeting] = useState(false);
  const [newReminder, setNewReminder] = useState(false);
  const [detail, setDetail] = useState<Entry | null>(null);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    if (show.work) {
      for (const i of state.items) {
        if (!i.dueDate || i.status === "cancelled") continue;
        // "My work" = subtasks assigned to me + tasks I own (personId means both).
        if (scope === "mine" && i.personId !== me.id) continue;
        const project = projectById(state, i.projectId);
        out.push({
          key: `w-${i.id}`,
          kind: "work",
          date: i.dueDate,
          title: i.title,
          sub: `${i.parentId ? terms.subtask.one : terms.task.one} · ${project?.name ?? ""}`,
          href: itemLink(state, i.id),
          overdue: isOverdue(i),
          closed: i.status === "done",
          status: i.status,
        });
      }
    }
    if (show.meeting) {
      for (const m of state.meetings) {
        if (scope === "mine" && !m.attendeeIds.includes(me.id)) continue;
        out.push({ key: `m-${m.id}`, kind: "meeting", date: m.date, time: m.time, title: m.title, sub: m.location, overdue: false, closed: m.date < today, meeting: m });
      }
    }
    if (show.reminder) {
      for (const r of state.reminders) {
        if (r.personId !== me.id) continue;
        out.push({ key: `r-${r.id}`, kind: "reminder", date: r.date, time: r.time, title: r.title, sub: r.category, overdue: false, closed: r.date < today, reminder: r });
      }
    }
    return out.sort((a, b) => (a.date + (a.time ?? "00:00")).localeCompare(b.date + (b.time ?? "00:00")));
  }, [state, me.id, scope, show, terms, today]);

  const byDay = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [entries]);

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
  });
  const monthKey = format(cursor, "yyyy-MM");
  const monthEntries = entries.filter((e) => e.date.startsWith(monthKey));
  const overdueCount = entries.filter((e) => e.overdue).length;

  const goToday = () => {
    setCursor(startOfMonth(parseISO(today)));
    setSelectedDay(today);
  };

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Due dates, meetings and your reminders."
        actions={
          <>
            <Button variant="secondary" onClick={() => setNewReminder(true)}>+ New reminder</Button>
            <Button onClick={() => setNewMeeting(true)}>+ New meeting</Button>
          </>
        }
      />

      {/* Controls */}
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCursor((c) => addMonths(c, -1))} aria-label="Previous month">‹</Button>
            <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
            <Button variant="secondary" size="sm" onClick={() => setCursor((c) => addMonths(c, 1))} aria-label="Next month">›</Button>
            <h2 className="ml-1 text-base font-semibold text-slate-900">{format(cursor, "MMMM yyyy")}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={scope}
              onChange={setScope}
              options={[{ key: "mine", label: "My work" }, { key: "all", label: "Everything" }]}
              label="Whose work to show"
            />
            <Segmented
              value={view}
              onChange={setView}
              options={[{ key: "month", label: "Month" }, { key: "list", label: "List" }]}
              label="Calendar view"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3" role="group" aria-label="What to show">
          {(Object.keys(KIND) as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
              aria-pressed={show[k]}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                show[k] ? "bg-white text-slate-800 ring-slate-300" : "bg-slate-50 text-slate-400 ring-slate-200 line-through"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${show[k] ? KIND[k].dot : "bg-slate-300"}`} aria-hidden />
              {KIND[k].label}
            </button>
          ))}
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden /> Overdue{overdueCount > 0 && ` (${overdueCount})`}
          </span>
        </div>
      </Card>

      {view === "month" ? (
        <>
          <Card className="overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium text-slate-500">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-2">
                  <span className="sm:hidden">{w[0]}</span>
                  <span className="hidden sm:inline">{w}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = iso(day);
                const list = byDay.get(key) ?? [];
                const inMonth = isSameMonth(day, cursor);
                const isToday = key === today;
                const isSelected = key === selectedDay;
                return (
                  <div
                    key={key}
                    className={`min-h-[56px] border-b border-r border-slate-100 p-1 sm:min-h-[110px] sm:p-1.5 ${inMonth ? "bg-white" : "bg-slate-50/60"} ${
                      isSelected ? "ring-2 ring-inset ring-indigo-300" : ""
                    }`}
                  >
                    <button
                      onClick={() => setSelectedDay(key)}
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        isToday ? "bg-indigo-600 font-semibold text-white" : inMonth ? "text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-100"
                      }`}
                      aria-label={`${format(day, "d MMMM")}, ${list.length} ${list.length === 1 ? "entry" : "entries"}`}
                    >
                      {format(day, "d")}
                    </button>
                    {/* Phones: coloured dots; select the day to see the list below. */}
                    <button onClick={() => setSelectedDay(key)} className="mt-1 flex flex-wrap gap-0.5 sm:hidden" tabIndex={-1} aria-hidden>
                      {list.slice(0, 6).map((e) => (
                        <span key={e.key} className={`h-1.5 w-1.5 rounded-full ${e.overdue ? "bg-red-500" : KIND[e.kind].dot}`} />
                      ))}
                    </button>
                    <div className="mt-1 hidden space-y-0.5 sm:block">
                      {list.slice(0, 3).map((e) => (
                        <EntryChip key={e.key} entry={e} onOpen={() => setDetail(e)} />
                      ))}
                      {list.length > 3 && (
                        <button onClick={() => setSelectedDay(key)} className="px-1 text-[11px] font-medium text-slate-500 hover:text-indigo-600">
                          +{list.length - 3} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="mt-4 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              {selectedDay === today ? "Today" : format(parseISO(selectedDay), "EEEE, d MMMM")}
            </h3>
            <AgendaList entries={byDay.get(selectedDay) ?? []} onOpen={setDetail} emptyText="Nothing on this day." />
          </Card>
        </>
      ) : monthEntries.length === 0 ? (
        <EmptyState icon="📅" title={`Nothing in ${format(cursor, "MMMM")}`} body="Try another month, switch to “Everything”, or turn on more entry types." />
      ) : (
        <div className="space-y-4">
          {[...new Set(monthEntries.map((e) => e.date))].map((date) => (
            <Card key={date} className="p-4">
              <h3 className={`mb-2 text-sm font-semibold ${date === today ? "text-indigo-700" : "text-slate-900"}`}>
                {date === today ? "Today · " : ""}
                {format(parseISO(date), "EEEE, d MMMM")}
              </h3>
              <AgendaList entries={byDay.get(date) ?? []} onOpen={setDetail} emptyText="" />
            </Card>
          ))}
        </div>
      )}

      <MeetingForm open={newMeeting} onClose={() => setNewMeeting(false)} defaultDate={selectedDay} />
      <ReminderForm open={newReminder} onClose={() => setNewReminder(false)} defaultDate={selectedDay} />
      <DetailModal entry={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[]; label: string }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${value === o.key ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function EntryChip({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const cls = `block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium ${entry.overdue ? OVERDUE_CHIP : KIND[entry.kind].chip} ${
    entry.closed ? "opacity-60" : ""
  }`;
  const text = `${entry.time ? entry.time + " " : ""}${entry.title}`;
  if (entry.href) {
    return <Link href={entry.href} className={cls} title={text}>{text}</Link>;
  }
  return <button onClick={onOpen} className={cls} title={text}>{text}</button>;
}

function AgendaList({ entries, onOpen, emptyText }: { entries: Entry[]; onOpen: (e: Entry) => void; emptyText: string }) {
  if (entries.length === 0) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {entries.map((e) => {
        const inner = (
          <>
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${e.overdue ? "bg-red-500" : KIND[e.kind].dot}`} aria-hidden />
            <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-slate-500">{e.time ?? "Due"}</span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm font-medium ${e.overdue ? "text-red-700" : "text-slate-800"} ${e.closed ? "opacity-60" : ""}`}>{e.title}</span>
              {e.sub && <span className="block truncate text-xs text-slate-500">{e.sub}</span>}
            </span>
            {e.status && <StatusPill status={e.status} />}
            {e.overdue && <span className="text-xs font-medium text-red-600">Overdue</span>}
          </>
        );
        const cls = "flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50";
        return (
          <li key={e.key}>
            {e.href ? <Link href={e.href} className={cls}>{inner}</Link> : <button onClick={() => onOpen(e)} className={cls}>{inner}</button>}
          </li>
        );
      })}
    </ul>
  );
}

function DetailModal({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const { state } = usePreview();
  const m = entry?.meeting;
  const r = entry?.reminder;
  return (
    <Modal open={!!entry} onClose={onClose} title={m ? "Meeting" : "Reminder"} widthClass="max-w-md">
      {entry && (
        <div className="space-y-3 text-sm">
          <div className="text-base font-semibold text-slate-900">{entry.title}</div>
          <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-2">
            <dt className="text-slate-500">When</dt>
            <dd className="text-slate-800">{fmtDate(entry.date)}{entry.time && ` at ${entry.time}`}</dd>
            {m && (
              <>
                <dt className="text-slate-500">Where</dt>
                <dd className="text-slate-800">{m.location || "—"}</dd>
                {m.projectId && (
                  <>
                    <dt className="text-slate-500">{state.org.terminology.project.one}</dt>
                    <dd>
                      <Link href={`/preview/projects/${m.projectId}`} className="text-indigo-600 hover:underline">
                        {projectById(state, m.projectId)?.name}
                      </Link>
                    </dd>
                  </>
                )}
                <dt className="text-slate-500">Attendees</dt>
                <dd className="flex flex-wrap gap-2">
                  {m.attendeeIds.map((id) => <PersonChip key={id} id={id} />)}
                </dd>
              </>
            )}
            {r && (
              <>
                <dt className="text-slate-500">Category</dt>
                <dd className="text-slate-800">{r.category}</dd>
              </>
            )}
          </dl>
          <div className="pt-1"><NotConnectedTag label="Email & push reminders not connected yet" /></div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function MeetingForm({ open, onClose, defaultDate }: { open: boolean; onClose: () => void; defaultDate: string }) {
  const { state, me, terms, addMeeting } = usePreview();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [projectId, setProjectId] = useState("");
  const [attendees, setAttendees] = useState<string[]>([me.id]);

  // Reset the form each time it opens, using the currently selected day.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTitle("");
      setDate(defaultDate);
      setTime("10:00");
      setLocation("");
      setProjectId("");
      setAttendees([me.id]);
    }
  }

  const toggle = (id: string) => setAttendees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    addMeeting({ title: title.trim(), date, time, location: location.trim(), projectId: projectId || null, attendeeIds: attendees });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="New meeting">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly review" required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Time"><input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} required /></Field>
        </div>
        <Field label="Where">
          <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room, site or video link" />
        </Field>
        <Field label={`${terms.project.one} (optional)`}>
          <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Not linked</option>
            {state.projects.filter((p) => p.state !== "closed").map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-slate-700">Attendees ({attendees.length})</legend>
          <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {state.people.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-50">
                <input type="checkbox" checked={attendees.includes(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                <PersonChip id={p.id} />
              </label>
            ))}
          </div>
        </fieldset>
        <FormFooter onClose={onClose} label="Add meeting" />
      </form>
    </Modal>
  );
}

function ReminderForm({ open, onClose, defaultDate }: { open: boolean; onClose: () => void; defaultDate: string }) {
  const { addReminder } = usePreview();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("09:00");
  const [category, setCategory] = useState(REMINDER_CATEGORIES[0]);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTitle("");
      setDate(defaultDate);
      setTime("09:00");
      setCategory(REMINDER_CATEGORIES[0]);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    addReminder({ title: title.trim(), date, time, category });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="New reminder">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Remind me to…">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Renew insurance" required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Time"><input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} required /></Field>
        </div>
        <Field label="Category">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {REMINDER_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <FormFooter onClose={onClose} label="Add reminder" />
      </form>
    </Modal>
  );
}

function FormFooter({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <NotConnectedTag label="Email & push reminders not connected yet" />
        It will show on the calendar now; notifications come later.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit">{label}</Button>
      </div>
    </div>
  );
}
