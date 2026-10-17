"use client";

// Admin & Settings: people, org structure, terminology, workflow rules,
// custom fields, templates and the activity log. Admins only.
// The open tab lives in `?tab=` so a reviewer can link straight to a section.

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePreview } from "@/lib/preview/store";
import { Button, Card, PageHeader, Tabs } from "@/components/preview/ui";
import PeopleTab from "@/components/preview/admin/PeopleTab";
import DepartmentsTab from "@/components/preview/admin/DepartmentsTab";
import DesignationsTab from "@/components/preview/admin/DesignationsTab";
import WorkflowTab from "@/components/preview/admin/WorkflowTab";
import CustomFieldsTab from "@/components/preview/admin/CustomFieldsTab";
import TemplatesTab from "@/components/preview/admin/TemplatesTab";
import ActivityTab from "@/components/preview/admin/ActivityTab";

const TAB_KEYS = ["people", "departments", "designations", "workflow", "fields", "templates", "activity"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default function AdminPage() {
  // useSearchParams() needs a Suspense boundary in Next 16.
  return (
    <Suspense fallback={<div className="py-10 text-center text-sm text-slate-500">Loading settings…</div>}>
      <AdminSettings />
    </Suspense>
  );
}

function AdminSettings() {
  const { state, me, switchUser } = usePreview();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const raw = params.get("tab");
  const tab: TabKey = TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : "people";
  const setTab = (t: TabKey) => router.replace(`${pathname}?tab=${t}`, { scroll: false });

  if (!me.isAdmin) {
    return (
      <div>
        <PageHeader title="Admin & Settings" />
        <Card className="mx-auto max-w-lg px-6 py-10 text-center">
          <div className="text-4xl" aria-hidden>🔒</div>
          <h2 className="mt-3 text-lg font-semibold text-slate-900">Only admins can change company settings</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            You&apos;re viewing the preview as {me.name}. Switch to an admin account to look around this page.
          </p>
          <Button className="mt-5" onClick={() => switchUser("u-sanjay")}>Switch to Sanjay Kumar (Admin)</Button>
        </Card>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "people", label: "People", count: state.people.length },
    { key: "departments", label: "Departments", count: state.departments.length },
    { key: "designations", label: "Designations & levels" },
    { key: "workflow", label: "Workflow & terminology" },
    { key: "fields", label: "Custom fields", count: state.customFields.length },
    { key: "templates", label: "Templates", count: state.templates.length },
    { key: "activity", label: "Activity log" },
  ];

  return (
    <div>
      <PageHeader
        title="Admin & Settings"
        subtitle={`Set up ${state.org.companyName} the way your team works — people, structure, names and rules.`}
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "people" && <PeopleTab />}
      {tab === "departments" && <DepartmentsTab />}
      {tab === "designations" && <DesignationsTab />}
      {tab === "workflow" && <WorkflowTab />}
      {tab === "fields" && <CustomFieldsTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "activity" && <ActivityTab />}
    </div>
  );
}
