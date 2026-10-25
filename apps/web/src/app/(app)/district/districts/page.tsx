"use client";

import { useState } from "react";
import { useResource } from "@/lib/useApi";
import { api, ApiError } from "@/lib/api";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, StatusBadge } from "@/components/ui";

interface DistrictRow {
  id: string; name: string; status: "PENDING" | "ACTIVE" | "DECLINED"; registeredAt: string | null; approvedAt: string | null; declineReason: string | null;
  contact: { name: string | null; role: string | null; email: string | null; phone: string | null; officeAddress: string | null };
  facilities: number; sharing: number;
}

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/** For regional offices: the districts that chose this office, and the decision on each new one. */
export default function RegionDistrictsPage() {
  const { data, error, reload } = useResource<{ districts: DistrictRow[] }>("/api/region/districts");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function decide(id: string, what: "approve" | "decline") {
    setBusy(id);
    setProblem(null);
    try {
      await api.post(`/api/region/districts/${id}/${what}`, what === "decline" ? { reason } : {});
      setDeclining(null);
      setReason("");
      reload();
    } catch (e) {
      setProblem(e instanceof ApiError && (e.body as { message?: string })?.message ? (e.body as { message: string }).message : "That did not save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return error instanceof ApiError && error.status === 403
      ? <Notice>This page is for regional offices.</Notice>
      : <LoadError onRetry={reload} />;
  }
  if (!data) return <Loading label="Loading the districts" />;
  const waiting = data.districts.filter((d) => d.status === "PENDING");
  const rest = data.districts.filter((d) => d.status !== "PENDING");
  return (
    <>
      <PageHeader title="Districts" description="Districts that chose this regional office. A district cannot sign in until you approve it." />
      {problem && <Notice tone="block">{problem}</Notice>}
      {waiting.length > 0 && (
        <div className="mb-6 space-y-4">
          {waiting.map((d) => (
            <Panel key={d.id} title={`Awaiting your approval: ${d.name}`} description={d.registeredAt ? `Registered ${day(d.registeredAt)}.` : undefined}>
              <p className="text-[15px]">{[d.contact.name, d.contact.role].filter(Boolean).join(", ")} · {d.contact.email}{d.contact.phone ? ` · ${d.contact.phone}` : ""}</p>
              {d.contact.officeAddress && <p className="text-sm text-[var(--muted)]">{d.contact.officeAddress}</p>}
              {declining === d.id ? (
                <div className="mt-3 max-w-md space-y-3">
                  <Field label="Reason" optional hint="The officer is told this.">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={busy === d.id} onClick={() => decide(d.id, "decline")}>Decline the district</Button>
                    <Button variant="quiet" onClick={() => setDeclining(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Button disabled={busy === d.id} onClick={() => decide(d.id, "approve")}>Approve</Button>
                  <Button variant="secondary" onClick={() => setDeclining(d.id)}>Decline</Button>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
      {rest.length === 0 && waiting.length === 0 ? (
        <EmptyState title="No districts yet">Districts appear here when they register and choose this regional office.</EmptyState>
      ) : (
        rest.length > 0 && (
          <Panel title="Your districts">
            <ul className="divide-y divide-[var(--border)]">
              {rest.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-sm text-[var(--muted)]">
                      {d.status === "DECLINED" ? `Declined${d.declineReason ? `: ${d.declineReason}` : ""}` : `${d.facilities} ${d.facilities === 1 ? "facility" : "facilities"}, ${d.sharing} sharing with the district`}
                    </p>
                  </div>
                  <StatusBadge tone={d.status === "ACTIVE" ? "success" : "neutral"}>{d.status === "ACTIVE" ? "Approved" : "Declined"}</StatusBadge>
                </li>
              ))}
            </ul>
          </Panel>
        )
      )}
    </>
  );
}
