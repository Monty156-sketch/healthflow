"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { Button, EmptyState, Loading, LoadError, Notice, PageHeader, Panel } from "@/components/ui";

interface Data {
  district: { id: string; name: string } | null;
  grant: { scopes: string[]; grantedAt: string; grantedBy: string | null } | null;
  log: { id: string; createdAt: string; summary: string }[];
}

const CHOICES: { scope: string; label: string; says: string }[] = [
  { scope: "COVERAGE", label: "Coverage", says: "How many staff are rostered against what each shift needs, for the coming days." },
  { scope: "STAFFING", label: "Staffing", says: "Approved posts, staff in post and vacancies by cadre, and counts of people away on leave by cadre. Never names or the kind of leave." },
  { scope: "ATTENDANCE", label: "Attendance", says: "How complete each month's attendance records are. Never who was present or absent." },
  { scope: "COMPLIANCE", label: "Compliance", says: "Counts of open and overridden rule findings. Never who they concern." },
];

export default function DirectorateAccess() {
  const { data, error, reload } = useResource<Data>("/api/facility/directorate");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "block"; text: string } | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading directorate access" />;
  if (!data.district) {
    return (
      <>
        <PageHeader title="Directorate access" />
        <EmptyState title="Your facility is not placed in a district">PS Tech sets this. Until then, nobody outside the facility can see anything.</EmptyState>
      </>
    );
  }
  const current = picked ?? data.grant?.scopes ?? [];
  const toggle = (s: string) => setPicked(current.includes(s) ? current.filter((x) => x !== s) : [...current, s]);

  async function save() {
    setMsg(null);
    try {
      await api.put("/api/facility/directorate", { scopes: current });
      setMsg({ tone: "success", text: "Saved. The change applies immediately." });
      setPicked(null);
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string; fields?: Record<string, string> }) : undefined;
      setMsg({ tone: "block", text: b?.message ?? (b?.fields ? Object.values(b.fields)[0] : "It was not saved. Try again.") });
    }
  }
  async function withdraw() {
    setMsg(null);
    try {
      await api.post("/api/facility/directorate/withdraw", {});
      setMsg({ tone: "success", text: "Access withdrawn. It stopped at once." });
      setPicked(null);
      reload();
    } catch {
      setMsg({ tone: "block", text: "It was not withdrawn. Try again." });
    }
  }

  return (
    <>
      <PageHeader title="Directorate access" description={`By default ${data.district.name} District sees nothing from your facility. Choose what it may read. You can withdraw access at any time and it stops at once.`} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Panel title="What the district may read">
        <p className="mb-3 text-sm text-[var(--muted)]">The district never sees photographs, telephone numbers, addresses, emergency contacts, individual leave or diagnoses.</p>
        <fieldset className="space-y-3">
          <legend className="sr-only">Information the district may read</legend>
          {CHOICES.map((c) => (
            <label key={c.scope} className="flex min-h-11 items-start gap-3">
              <input type="checkbox" className="mt-1 size-5" checked={current.includes(c.scope)} onChange={() => toggle(c.scope)} />
              <span>
                <span className="block font-medium">{c.label}</span>
                <span className="block text-sm text-[var(--muted)]">{c.says}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={save} disabled={current.length === 0}>Save access</Button>
          {data.grant && <Button variant="secondary" onClick={withdraw}>Withdraw all access</Button>}
        </div>
        {data.grant && <p className="mt-3 text-sm text-[var(--muted)]">Granted {showDateTime(data.grant.grantedAt)}{data.grant.grantedBy ? ` by ${data.grant.grantedBy}` : ""}.</p>}
      </Panel>
      <div className="mt-6">
        <Panel title="Who has looked">
        <p className="mb-3 text-sm text-[var(--muted)]">Each time the district reads something from your facility it is listed here.</p>
          {data.log.length === 0 ? (
            <p className="text-[15px] text-[var(--muted)]">The district has not read anything yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] text-[15px]">
              {data.log.map((l) => (
                <li key={l.id} className="py-2">
                  <span className="figures mr-2 text-sm text-[var(--muted)]">{showDateTime(l.createdAt)}</span>
                  {l.summary}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
