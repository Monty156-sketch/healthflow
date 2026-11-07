"use client";

import { useFacility } from "@/components/AppShell";
import { ApprovalQueue } from "@/components/ApprovalQueue";
import { PageHeader } from "@/components/ui";

export default function ApprovalsPage() {
  const { isAdmin } = useFacility();
  return (
    <>
      <PageHeader title="Roster approvals" description="Rosters waiting for approval, and who they are waiting on." />
      <ApprovalQueue canSwitch={isAdmin} />
    </>
  );
}
