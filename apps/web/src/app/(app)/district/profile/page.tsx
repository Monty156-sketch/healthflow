"use client";

import { useResource } from "@/lib/useApi";
import { Loading, LoadError, Notice, PageHeader, Panel } from "@/components/ui";

interface Profile {
  district: {
    name: string;
    region: string;
    status: string;
    registeredAt: string | null;
    approvedAt: string | null;
    contact: { name: string | null; role: string | null; email: string | null; phone: string | null; officeAddress: string | null };
  };
}

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "Not recorded");

export default function DistrictProfilePage() {
  const { data, error, reload } = useResource<Profile>("/api/district/profile");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading the district profile" />;
  const d = data.district;
  const rows: [string, string][] = [
    ["District", d.name],
    ["Region", d.region],
    ["Registered", day(d.registeredAt)],
    ["Approved", day(d.approvedAt)],
    ["Officer", [d.contact.name, d.contact.role].filter(Boolean).join(", ") || "Not recorded"],
    ["Email", d.contact.email ?? "Not recorded"],
    ["Telephone", d.contact.phone ?? "Not recorded"],
    ["Office address", d.contact.officeAddress ?? "Not recorded"],
  ];
  return (
    <>
      <PageHeader title="District profile" description="The details this district registered with." />
      <Panel title={d.name}>
        <dl className="grid gap-x-6 gap-y-3 text-[15px] sm:grid-cols-[10rem_1fr]">
          {rows.map(([k, val]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--muted)]">{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <div className="mt-4">
        <Notice>To change any of these details, call PS Tech on 055 457 1800 or 024 618 7422. The district view is read only.</Notice>
      </div>
    </>
  );
}
