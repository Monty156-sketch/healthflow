"use client";

import { useResource } from "@/lib/useApi";
import { EmptyState, Loading, LoadError, Notice, PageHeader, StatusBadge, TableScroll, TD, TH } from "@/components/ui";

interface Row {
  id: string;
  name: string;
  type: string;
  joinedAt: string;
  grantedAccess: boolean;
  suspended: boolean;
  suspendedReason: string | null;
}

const TYPE: Record<string, string> = {
  CHPS_COMPOUND: "CHPS compound", HEALTH_CENTRE: "Health centre", CLINIC: "Clinic", POLYCLINIC: "Polyclinic", HOSPITAL: "Hospital", PRIVATE_HOSPITAL: "Private hospital", REGIONAL_HOSPITAL: "Regional hospital", TEACHING_HOSPITAL: "Teaching hospital",
};

export default function DistrictFacilitiesPage() {
  const { data, error, reload } = useResource<{ facilities: Row[] }>("/api/district/facilities");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading facilities" />;
  const granted = data.facilities.filter((f) => f.grantedAccess).length;
  return (
    <>
      <PageHeader title="Facilities" description="Every facility that chose this district. A facility shows here from the day it joins; its coverage, establishment and leave appear in the other screens only after it grants access." />
      {data.facilities.length === 0 ? (
        <EmptyState title="No facility has joined yet">Facilities choose their district when they ask for access. Once one is set up under your district it appears here.</EmptyState>
      ) : (
        <>
          <div className="mb-4">
            <Notice>{granted} of {data.facilities.length} {data.facilities.length === 1 ? "facility has" : "facilities have"} granted this district access.</Notice>
          </div>
          <TableScroll label="Facilities in this district">
            <table className="w-full text-left text-[15px]">
              <thead>
                <tr>{["Facility", "Type", "Joined", "Access"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.facilities.map((f) => (
                  <tr key={f.id}>
                    <td className={TD}>{f.name}</td>
                    <td className={TD}>{TYPE[f.type] ?? f.type}</td>
                    <td className={TD}>{new Date(f.joinedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td className={TD}>{f.suspended ? <><StatusBadge tone="block">Suspended</StatusBadge>{f.suspendedReason && <span className="block text-sm text-[var(--muted)]">{f.suspendedReason}</span>}</> : <StatusBadge tone={f.grantedAccess ? "success" : "neutral"}>{f.grantedAccess ? "Granted" : "Not granted"}</StatusBadge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
    </>
  );
}
