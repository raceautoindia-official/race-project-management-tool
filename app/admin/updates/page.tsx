import Link from "next/link";
import { requirePageAdmin } from "@/lib/page-guard";
import { getUpdateSettings } from "@/lib/work-updates";
import AppShell from "@/components/AppShell";
import { PageHeader, SectionCard } from "@/components/Cards";
import UpdateSettingsForm from "@/components/admin/UpdateSettingsForm";

export const dynamic = "force-dynamic";

/** Admin › Update reminders — when daily and weekly update reminders go out. */
export default async function UpdateRemindersPage() {
  const user = await requirePageAdmin();
  const settings = await getUpdateSettings();
  return (
    <AppShell user={user}>
      <PageHeader
        title="Update reminders"
        subtitle="Everyone except admins owes a daily update Monday to Saturday, and a weekly plan and summary. Times are India time."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <SectionCard title="Schedule">
          <UpdateSettingsForm initial={settings} />
        </SectionCard>
        <SectionCard title="How it works">
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>People write their update in <strong>Work Updates</strong> and press <strong>Submit update</strong>.</li>
            <li>Whatever isn&apos;t submitted by the auto-submit time is submitted by the app, marked <em>auto-submitted</em>.</li>
            <li>A day locks at midnight; a week at midnight on Saturday. Sunday is off.</li>
            <li>
              Read anyone&apos;s updates, and remind people by hand, from{" "}
              <Link href="/team?tab=updates" className="font-medium text-indigo-600 hover:underline">Team › Daily updates</Link>{" "}
              or a person&apos;s profile.
            </li>
            <li>
              The server runs this every 15 minutes through <code className="rounded bg-slate-100 px-1">/api/cron/work-updates</code>{" "}
              (see the README for the crontab line).
            </li>
          </ul>
        </SectionCard>
      </div>
    </AppShell>
  );
}
