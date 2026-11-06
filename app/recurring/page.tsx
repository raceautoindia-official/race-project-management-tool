import { requirePageUser } from "@/lib/page-guard";
import { listRules, istDate } from "@/lib/recurring";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import RecurringView from "@/components/recurring/RecurringView";

export const dynamic = "force-dynamic";

/**
 * Recurring — every repeating task a person can see, in one place: theirs,
 * their projects', and (for an admin) the proposals waiting for approval.
 * New ones are set up here, from a project's ↻ Recurring button, or from
 * the + New on My Work.
 */
export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<{ rule?: string; project?: string; new?: string }>;
}) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const rules = await listRules(user);
  const pending = rules.filter((r) => r.approvalStatus === "pending").length;
  const running = rules.filter((r) => r.approvalStatus === "approved" && r.isActive).length;
  const dueSoon = rules.filter((r) => r.next && r.mine).length;

  return (
    <AppShell user={user}>
      <PageHeader
        title="Recurring"
        subtitle="Work that comes round again — daily checks, weekly reports, monthly filings. Each copy arrives as a task with its subtasks, on the owner's working days."
        figures={[
          { label: "Running", value: running },
          { label: user.role === "admin" ? "To approve" : "Waiting for approval", value: pending },
          { label: "Coming to me", value: dueSoon },
        ]}
      />
      <RecurringView
        rules={rules}
        me={{ id: user.id, isAdmin: user.role === "admin" }}
        today={istDate()}
        focusRuleId={Number(sp.rule) || null}
        projectId={Number(sp.project) || null}
        openNew={sp.new === "1"}
      />
    </AppShell>
  );
}
