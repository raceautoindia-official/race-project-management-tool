import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader, SectionCard } from "@/components/Cards";
import { RoleBadge } from "@/components/Badge";
import Avatar from "@/components/Avatar";
import ProfileForm from "@/components/ProfileForm";
import PushToggle from "@/components/PushToggle";
import CalendarSubscribe from "@/components/CalendarSubscribe";
import { appBaseUrl } from "@/lib/mailer";
import { calendarFeedUrl } from "@/lib/calendar-links";
import { whatsappConfigured } from "@/lib/whatsapp";
import { formatDate, formatRelative } from "@/lib/format";
import { parseUtc } from "@/lib/ics";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requirePageUser();
  const [row] = await query<DbRow[]>(
    `SELECT phone, whatsapp_opt_in, calendar_token, calendar_feed_fetched_at
       FROM users WHERE id = ?`,
    [user.id]
  );
  const calendarUrl = row?.calendar_token
    ? calendarFeedUrl(appBaseUrl(), String(row.calendar_token))
    : null;
  // Formatted here, not in the client component: a relative time computed on
  // both sides would not match and React would complain about it.
  const lastFetchedLabel = row?.calendar_feed_fetched_at
    ? formatRelative(parseUtc(String(row.calendar_feed_fetched_at)))
    : null;

  return (
    <AppShell user={user}>
      <PageHeader
        title="Profile"
        subtitle="Your account details. Login credentials are managed in the Attendance app."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Account">
          <div className="mb-4 flex items-center gap-3">
            <Avatar name={user.name} size="lg" />
            <div>
              <div className="font-semibold text-slate-800">{user.name}</div>
              <div className="text-sm text-slate-500">{user.email}</div>
            </div>
          </div>

          <ProfileForm
            initialName={user.name}
            initialPhone={(row?.phone as string) ?? ""}
            initialWhatsapp={Boolean(row?.whatsapp_opt_in)}
            whatsappAvailable={whatsappConfigured()}
          />

          <dl className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Role</dt>
              <dd>
                <RoleBadge role={user.role} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Member since</dt>
              <dd className="font-medium text-slate-800">
                {formatDate(user.created_at)}
              </dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard title="Browser notifications">
          <PushToggle />
        </SectionCard>

        <SectionCard title="Calendar subscription">
          <CalendarSubscribe
            initialUrl={calendarUrl}
            lastFetchedLabel={lastFetchedLabel}
          />
        </SectionCard>
      </div>
    </AppShell>
  );
}
