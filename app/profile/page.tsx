import { requirePageUser } from "@/lib/page-guard";
import AppShell from "@/components/AppShell";
import { PageHeader, SectionCard } from "@/components/Cards";
import { RoleBadge } from "@/components/Badge";
import Avatar from "@/components/Avatar";
import ProfileForm from "@/components/ProfileForm";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requirePageUser();

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
              <div className="text-sm text-slate-400">{user.email}</div>
            </div>
          </div>

          <ProfileForm initialName={user.name} />

          <dl className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">Role</dt>
              <dd>
                <RoleBadge role={user.role} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Member since</dt>
              <dd className="font-medium text-slate-800">
                {formatDate(user.created_at)}
              </dd>
            </div>
          </dl>
        </SectionCard>
      </div>
    </AppShell>
  );
}
