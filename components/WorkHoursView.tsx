"use client";

import Link from "next/link";
import { formatMinutes, type PersonWorkHours } from "@/lib/work-hours";

const DAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Shift a "YYYY-MM-DD" by whole days without touching the local time zone. */
function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function prettyRange(from: string, to: string): string {
  const fmt = (s: string) =>
    new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return `${fmt(from)} – ${fmt(to)}`;
}

/** A day's cell: what the two systems each recorded. */
function DayCell({ day, isToday }: { day: PersonWorkHours["days"][number]; isToday: boolean }) {
  const away = day.status === "holiday" || day.status === "leave";
  const noRecord = day.status === null || day.status === "absent";

  return (
    <td
      className={`px-2 py-2 text-center align-top text-xs ${
        isToday ? "bg-indigo-50" : away ? "bg-slate-50" : ""
      }`}
    >
      {day.presentMinutes > 0 ? (
        <div className="font-medium text-slate-800">{formatMinutes(day.presentMinutes)}</div>
      ) : (
        <div className="text-slate-400">{away ? (day.status === "leave" ? "Leave" : "Holiday") : "—"}</div>
      )}
      <div className={day.loggedMinutes > 0 ? "text-indigo-700" : "text-slate-400"}>
        {day.loggedMinutes > 0 ? formatMinutes(day.loggedMinutes) : noRecord ? "" : "0m"}
      </div>
    </td>
  );
}

export default function WorkHoursView({
  people,
  from,
  to,
  ownOnly,
  today,
}: {
  people: PersonWorkHours[];
  from: string;
  to: string;
  ownOnly: boolean;
  today: string;
}) {
  const thisWeek = shiftDays(today, -(((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)));
  const atThisWeek = from === thisWeek;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/work-hours?week=${shiftDays(from, -7)}`}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          ‹ Previous week
        </Link>
        <Link
          href="/work-hours"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          This week
        </Link>
        {!atThisWeek && (
          <Link
            href={`/work-hours?week=${shiftDays(from, 7)}`}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Next week ›
          </Link>
        )}
        <span className="ml-1 text-sm font-semibold text-slate-800">{prettyRange(from, to)}</span>
      </div>

      {people.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
          Nothing to show for this week.
        </div>
      ) : (
        <div tabIndex={0} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">
              Hours at work and hours logged against tasks, {prettyRange(from, to)}
            </caption>
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-600">
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Person
                </th>
                {people[0].days.map((d, i) => (
                  <th key={d.date} scope="col" className="px-2 py-2 text-center font-semibold">
                    {DAY_LABEL[i]}
                    <span className="block font-normal text-slate-500">{d.date.slice(8)}</span>
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  At work
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Logged
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {people.map((p) => (
                <tr key={p.userId}>
                  <th scope="row" className="px-3 py-2 text-left font-medium text-slate-800">
                    {p.name}
                    {p.department && (
                      <span className="block text-xs font-normal text-slate-500">
                        {p.department}
                      </span>
                    )}
                  </th>
                  {p.days.map((d) => (
                    <DayCell key={d.date} day={d} isToday={d.date === today} />
                  ))}
                  <td className="px-3 py-2 text-right font-semibold text-slate-800">
                    {formatMinutes(p.presentMinutes)}
                    <span className="block text-xs font-normal text-slate-500">
                      {p.daysPresent} {p.daysPresent === 1 ? "day" : "days"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-indigo-700">
                    {formatMinutes(p.loggedMinutes)}
                    {p.coverage !== null && (
                      <span className="block text-xs font-normal text-slate-500">
                        {Math.round(p.coverage * 100)}% of time at work
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-600">
        Grey figure: time at work, from the Attendance app. Blue: time logged against tasks
        here.{" "}
        {ownOnly
          ? "You are seeing your own week."
          : "You are seeing yourself and the people who report to you."}{" "}
        A gap usually means time not yet logged — meetings, travel and reading rarely have a
        task open — so treat it as a reminder to log, not as a measure of effort.
      </p>
    </div>
  );
}
