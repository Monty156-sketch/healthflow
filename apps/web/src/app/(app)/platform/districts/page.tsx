"use client";

import { agencyName, AGENCIES } from "@/lib/agency";
import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select } from "@/components/ui";

interface Data {
  districts: { id: string; name: string; region: string; agency: string; status: "PENDING" | "ACTIVE" | "DECLINED"; registeredAt: string | null; declineReason: string | null; contact: { name: string | null; role: string | null; email: string | null; phone: string | null; officeAddress: string | null }; facilities: { id: string; name: string }[]; officers: { id: string; email: string; active: boolean }[] }[];
  unassigned: { id: string; name: string }[];
}

export default function DistrictsPage() {
  const { data, error, reload } = useResource<Data>("/api/platform/districts");
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [agency, setAgency] = useState("GHS");
  const [msg, setMsg] = useState<{ tone: "success" | "block"; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [officer, setOfficer] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading districts" />;

  const fail = (e: unknown) => {
    const b = e instanceof ApiError ? (e.body as { message?: string; fields?: Record<string, string> }) : undefined;
    setMsg({ tone: "block", text: b?.message ?? (b?.fields ? Object.values(b.fields)[0] : "That did not work. Try again.") });
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.post("/api/platform/districts", { name, region, agency });
      setName("");
      setRegion("");
      reload();
    } catch (err) { fail(err); }
  }
  async function decide(id: string, action: "approve" | "decline") {
    setMsg(null);
    try {
      await api.post(`/api/platform/districts/${id}/${action}`, action === "decline" ? { reason: reasons[id] ?? "" } : {});
      setMsg({ tone: "success", text: action === "approve" ? "District approved. Its officer can sign in and facilities can choose it." : "District declined." });
      reload();
    } catch (err) { fail(err); }
  }
  async function assign(facilityId: string, districtId: string | null) {
    setMsg(null);
    try {
      await api.put(`/api/platform/facilities/${facilityId}/district`, { districtId });
      setMsg({ tone: "success", text: "District set. Any earlier access the facility gave was ended." });
      reload();
    } catch (err) { fail(err); }
  }
  async function addOfficer(districtId: string) {
    setMsg(null);
    setLink(null);
    try {
      const r = await api.post<{ url: string }>(`/api/platform/districts/${districtId}/officers`, { email: officer[districtId] ?? "" });
      setLink(r.url);
      setOfficer({ ...officer, [districtId]: "" });
      reload();
    } catch (err) { fail(err); }
  }

  return (
    <>
      <PageHeader title="Districts" description="Create a district, place facilities in it and create the officer logins. A district sees nothing until a facility grants it access." />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {link && (
        <Notice tone="success">
          Send this one-time link to the officer so they can set a password. It expires in 60 minutes and is shown only now.
          <span className="mt-1 block break-all text-sm">{link}</span>
        </Notice>
      )}
      {data.districts.some((d) => d.status === "PENDING") && (
        <div className="mb-6 space-y-4">
          {data.districts.filter((d) => d.status === "PENDING").map((d) => (
            <Panel key={d.id} title={`Awaiting approval: ${d.name}, ${d.region} (${agencyName(d.agency)})`} description={d.registeredAt ? `Registered ${new Date(d.registeredAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.` : undefined}>
              <dl className="grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-[9rem_1fr]">
                {([["Officer", [d.contact.name, d.contact.role].filter(Boolean).join(", ")], ["Email", d.contact.email], ["Telephone", d.contact.phone], ["Office", d.contact.officeAddress]] as [string, string | null][]).map(([k, val]) => (
                  <div key={k} className="contents"><dt className="text-[var(--muted)]">{k}</dt><dd>{val || "Not given"}</dd></div>
                ))}
              </dl>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Button onClick={() => decide(d.id, "approve")}>Approve</Button>
                <Field label="Reason, if declining" optional>{(a) => <Input {...a} value={reasons[d.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [d.id]: e.target.value })} />}</Field>
                <Button variant="secondary" onClick={() => decide(d.id, "decline")}>Decline</Button>
              </div>
            </Panel>
          ))}
        </div>
      )}
      <Panel title="New district">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <Field label="Name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
          <Field label="Region">{(a) => <Input {...a} value={region} onChange={(e) => setRegion(e.target.value)} required />}</Field>
          <Field label="Registered under">{(a) => <Select {...a} value={agency} onChange={(e) => setAgency(e.target.value)}>{AGENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          <Button type="submit">Create district</Button>
        </form>
      </Panel>
      <div className="mt-6 space-y-6">
        {data.districts.filter((d) => d.status !== "PENDING").map((d) => (
          <Panel key={d.id} title={`${d.name}, ${d.region} (${agencyName(d.agency)})${d.status === "DECLINED" ? " (declined)" : ""}`} description={d.status === "DECLINED" && d.declineReason ? `Declined: ${d.declineReason}` : undefined}>
            <h3 className="text-sm font-medium text-[var(--muted)]">Facilities</h3>
            {d.facilities.length === 0 ? <p className="text-[15px]">None placed yet.</p> : (
              <ul className="text-[15px]">
                {d.facilities.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                    {f.name}
                    <Button variant="secondary" onClick={() => assign(f.id, null)}>Remove</Button>
                  </li>
                ))}
              </ul>
            )}
            {data.unassigned.length > 0 && (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <Select aria-label={`Add a facility to ${d.name}`} defaultValue="" onChange={(e) => e.target.value && assign(e.target.value, d.id)} className="max-w-xs">
                  <option value="">Add a facility</option>
                  {data.unassigned.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              </div>
            )}
            <h3 className="mt-4 text-sm font-medium text-[var(--muted)]">Officers</h3>
            {d.officers.length === 0 ? <p className="text-[15px]">No officer accounts.</p> : (
              <ul className="text-[15px]">{d.officers.map((o) => <li key={o.id}>{o.email}{o.active ? "" : " (inactive)"}</li>)}</ul>
            )}
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <Field label="Officer email">{(a) => <Input {...a} type="email" value={officer[d.id] ?? ""} onChange={(e) => setOfficer({ ...officer, [d.id]: e.target.value })} />}</Field>
              <Button variant="secondary" onClick={() => addOfficer(d.id)}>Create officer login</Button>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
