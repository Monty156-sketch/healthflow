"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { FACILITY_TYPE } from "@/lib/format";
import { Button, ButtonLink, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select } from "@/components/ui";

interface Options { districts: { id: string; name: string; region: string }[]; facilities: { id: string; name: string }[]; types: string[] }
interface Done { seeded: { departments: number; cadres: number }; copied: { shifts: number; rules: number } | null; url: string; emailed: boolean; starterNotice: boolean }

export default function NewFacility() {
  const { data, error, reload } = useResource<Options>("/api/platform/setup-options");
  const [existing] = useState(() => (typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("facility") ?? "")));
  const [name, setName] = useState("");
  const [type, setType] = useState("HEALTH_CENTRE");
  const [districtId, setDistrictId] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<(Done & { facilityId: string }) | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading" />;

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      let facilityId = existing;
      if (!facilityId) facilityId = (await api.post<{ facilityId: string }>("/api/platform/facilities", { name, facilityType: type, districtId: districtId || null })).facilityId;
      const out = await api.post<Done>(`/api/platform/facilities/${facilityId}/setup`, { copyFromFacilityId: copyFrom || null, adminName, adminEmail });
      setDone({ ...out, facilityId });
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string; fields?: Record<string, string> }) : undefined;
      setProblem(b?.message ?? (b?.fields ? Object.values(b.fields)[0] : "That did not work. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <PageHeader title="Facility set up" />
        <Notice tone="success">
          {done.seeded.departments} departments and {done.seeded.cadres} cadres added{done.copied ? `, ${done.copied.shifts} shifts copied` : ""}. {done.emailed ? "The invitation was emailed." : "Email is not set up, so send the link yourself."}
          <span className="mt-2 block text-sm">Send the administrator this one-time link. It works for 7 days.</span>
          <span className="mt-1 block break-all text-sm">{done.url}</span>
        </Notice>
        {done.starterNotice && <div className="mt-4"><Notice tone="warning">A starter privacy notice was published so the invitation can be accepted. Tell the administrator to read it, edit it and publish their own under Privacy and data protection.</Notice></div>}
        <p className="mt-4 text-[15px]">Staff are imported by the facility itself from its Staff page, so HealthFlow staff never handle the facility&apos;s staff list.</p>
        <div className="mt-4"><ButtonLink href={`/platform/facilities/${done.facilityId}`}>Open the facility</ButtonLink></div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={existing ? "Set up this facility" : "New facility"} description="Creates the facility as a trial, adds starting departments and cadres for its type, optionally copies shifts and rules from another facility, and invites its administrator. Only for a facility with a signed agreement." />
      {problem && <Notice tone="block">{problem}</Notice>}
      <form onSubmit={run} className="max-w-xl space-y-6">
        {!existing && (
          <Panel title="1. The facility">
            <div className="space-y-3">
              <Field label="Name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
              <Field label="Type">
                {(a) => (
                  <Select {...a} value={type} onChange={(e) => setType(e.target.value)}>
                    {data.types.map((t) => <option key={t} value={t}>{FACILITY_TYPE[t] ?? t}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="District" optional>
                {(a) => (
                  <Select {...a} value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
                    <option value="">None yet</option>
                    {data.districts.map((d) => <option key={d.id} value={d.id}>{d.name}, {d.region}</option>)}
                  </Select>
                )}
              </Field>
            </div>
          </Panel>
        )}
        <Panel title={existing ? "1. Starting point" : "2. Starting point"}>
          <Field label="Copy shifts and rules from" optional hint="Cadres in each shift are matched by name.">
            {(a) => (
              <Select {...a} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Start with the standard rules only</option>
                {data.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            )}
          </Field>
        </Panel>
        <Panel title={existing ? "2. The facility administrator" : "3. The facility administrator"}>
          <div className="space-y-3">
            <Field label="Name">{(a) => <Input {...a} value={adminName} onChange={(e) => setAdminName(e.target.value)} required />}</Field>
            <Field label="Email">{(a) => <Input {...a} type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />}</Field>
          </div>
        </Panel>
        <Button type="submit" disabled={busy || (!existing && name.trim().length < 2)}>{busy ? "Setting up…" : "Set up and invite"}</Button>
      </form>
    </>
  );
}
