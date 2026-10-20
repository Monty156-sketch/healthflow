"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFacility } from "@/components/AppShell";
import { StaffForm } from "@/components/StaffForm";
import { Notice, PageHeader, Panel } from "@/components/ui";

export default function NewStaffPage() {
  const router = useRouter();
  const { isAdmin, reload } = useFacility();

  if (!isAdmin) {
    return <Notice>Only a facility admin can add staff.</Notice>;
  }

  return (
    <>
      <p className="mb-2">
        <Link href="/staff" className="inline-flex min-h-11 items-center text-sm text-[var(--accent-text)] underline-offset-4 hover:underline">
          Back to staff
        </Link>
      </p>
      <PageHeader
        title="Add staff member"
        description="Add them to the roster. Invite them to sign in later."
      />
      <Panel>
        <StaffForm
          submitLabel="Add staff member"
          onSaved={(s) => {
            reload();
            router.push(`/staff/${s.id}?added=1`);
          }}
          onCancel={() => router.push("/staff")}
        />
      </Panel>
    </>
  );
}
