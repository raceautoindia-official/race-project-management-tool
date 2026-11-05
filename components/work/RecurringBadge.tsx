import Link from "next/link";

/** "↻ Recurring · Thu 6 Nov" on a copy of a recurring task, linking to its rule. */
export default function RecurringBadge({
  ruleId,
  date,
  noReview,
}: {
  ruleId: number;
  date: string | null | undefined;
  noReview?: boolean | number;
}) {
  const day = date
    ? new Date(`${String(date).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    : null;
  return (
    <Link
      href={`/recurring?rule=${ruleId}`}
      title="A copy of a recurring task — open its schedule"
      className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-200"
    >
      ↻ Recurring{day ? ` · ${day}` : ""}
      {noReview ? " · no review" : ""}
    </Link>
  );
}
