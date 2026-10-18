"use client";

import { FormEvent, useState } from "react";
import { setSupport } from "@/lib/supportSession";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { failure, type Say } from "@/lib/adminBits";
import { Button, EmptyState, Field, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, Textarea } from "@/components/ui";

interface Sess { id: string; facilityId: string; facility: string; by: string; reason: string; accessLevel: string; startedAt: string; expiresAt: string; endedAt: string | null; endedReason: string | null; active: boolean }

export default function SupportPage() {
  const sessions = useResource<{ sessions: Sess[] }>("/api/platform/support-sessions");
  const facs = useResource<{ facilities: { id: string; name: string }[] }>("/api/platform/facilities");
  const [facilityId, setFacilityId] = useState("");
  const [reason, setReason] = useState("");
  const [level, setLevel] = useState("READ_ONLY");
  const [say, setSay] = useState<Say>(null);
    const [view, setView] = useState<{ id: string; title: string; rows: string[] } | null>(null);
  if (sessions.error && !sessions.data) return <LoadError onRetry={sessions.reload} />;
  if (!sessions.data || !facs.data) return <Loading />;

  async function start(e: FormEvent) {
    e.preventDefault();
    setSay(null);
    try { await api.post("/api/platform/support-sessions", { facilityId, reason, accessLevel: level }); setReason(""); sessions.reload(); } catch (err) { setSay({ tone: "block", text: failure(err) }); }
  }
  async function end(id: string) { try { await api.post(`/api/platform/support-sessions/${id}/end`, {}); setView(null); sessions.reload(); } catch (err) { setSay({ tone: "block", text: failure(err) }); } }
  async function open(id: string, what: "staff" | "rosters") {
    setSay(null);
    try {
      if (what === "staff") {
        const r = await api.get<{ staff: { staffNo: string; fullName: string; cadre: string | null; department: string | null; status: string }[] }>(`/api/platform/support-sessions/${id}/view/staff`);
        setView({ id, title: "Staff list", rows: r.staff.map((s) => `${s.staffNo}  ${s.fullName}  ${[s.cadre, s.department, s.status.toLowerCase()].filter(Boolean).join(", ")}`) });
      } else {
        const r = await api.get<{ rosters: { year: number; month: number; status: string; version: number; hasUnresolvedConflicts: boolean }[] }>(`/api/platform/support-sessions/${id}/view/rosters`);
        setView({ id, title: "Rosters", rows: r.rosters.map((x) => `${x.year}-${String(x.month).padStart(2, "0")}  ${x.status.toLowerCase()}, version ${x.version}${x.hasUnresolvedConflicts ? ", unresolved conflicts" : ""}`) });
      }
    } catch (err) { setSay({ tone: "block", text: failure(err) }); }
  }
  const active = sessions.data.sessions.filter((s) => s.active);

  return (
    <>
      <PageHeader title="Support access" description="To see what a facility sees, start a session with a written reason. The facility sees a banner for as long as it is open, and the session ends by itself after 60 minutes." />
      {say && <Notice tone={say.tone}>{say.text}</Notice>}
      <div className="space-y-6">
        <Panel title="Start a session">
          <form onSubmit={start} className="max-w-xl space-y-3">
            <Field label="Facility">{(a) => <Select {...a} value={facilityId} onChange={(e) => setFacilityId(e.target.value)} required><option value="">Choose</option>{facs.data!.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
            <Field label="Reason" hint="The facility reads this exactly as written.">{(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required />}</Field>
            <Field label="Access">{(a) => <Select {...a} value={level} onChange={(e) => setLevel(e.target.value)}><option value="READ_ONLY">Read only</option><option value="FULL">Full: open the facility as its administrator and change things. Every change is written to the facility&apos;s audit log. Personal-data requests, invitations and billing stay with the facility.</option></Select>}</Field>
            <Button type="submit" disabled={!facilityId || reason.trim().length < 10}>Start session</Button>
          </form>
        </Panel>
        <Panel title="Open sessions">
          {active.length === 0 ? <p className="text-[15px] text-[var(--muted)]">None open.</p> : (
            <ul className="divide-y divide-[var(--border)] text-[15px]">
              {active.map((s) => (
                <li key={s.id} className="py-3">
                  <p><strong>{s.facility}</strong> <StatusBadge tone="warning">{s.accessLevel === "FULL" ? "full" : "read only"}</StatusBadge> <span className="text-sm text-[var(--muted)]">ends {showDateTime(s.expiresAt)}</span></p>
                  <p className="text-[var(--muted)]">{s.reason}</p>
                  <div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => { setSupport({ id: s.id, facility: s.facility, level: s.accessLevel === "FULL" ? "FULL" : "READ_ONLY", expiresAt: s.expiresAt }); window.location.assign("/dashboard"); }}>{s.accessLevel === "FULL" ? "Open facility with full access" : "Open facility, read only"}</Button><Button variant="secondary" onClick={() => open(s.id, "staff")}>View staff list</Button><Button variant="secondary" onClick={() => open(s.id, "rosters")}>View rosters</Button><Button variant="secondary" onClick={() => end(s.id)}>End session</Button></div>
                </li>
              ))}
            </ul>
          )}
          {view && (
            <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] p-3">
              <p className="font-medium">{view.title}</p>
              <p className="mb-2 text-sm text-[var(--muted)]">Names, numbers, cadres and departments only. Telephone numbers, photographs, emergency contacts and leave are never shown here.</p>
              <ul className="figures max-h-72 overflow-auto text-sm">{view.rows.map((r, i) => <li key={i} className="whitespace-pre">{r}</li>)}</ul>
            </div>
          )}
        </Panel>
        <Panel title="History">
          {sessions.data.sessions.length === 0 ? <EmptyState title="No sessions yet" /> : (
            <ul className="divide-y divide-[var(--border)] text-[15px]">
              {sessions.data.sessions.map((s) => (
                <li key={s.id} className="py-2"><span className="figures text-sm text-[var(--muted)]">{showDateTime(s.startedAt)}</span> {s.facility}, {s.by}: {s.reason}<span className="text-sm text-[var(--muted)]">{s.active ? " Open." : s.endedReason === "EXPIRED" ? " Timed out." : " Ended by hand."}</span></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
