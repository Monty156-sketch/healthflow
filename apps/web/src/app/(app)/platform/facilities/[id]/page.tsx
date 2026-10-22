"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useResource } from "@/lib/useApi";
import { showDate, showDateTime } from "@/lib/format";
import { HEALTH_TONE, HEALTH_WORD, cedi } from "@/lib/console";
import { api, ApiError } from "@/lib/api";
import { Button, ButtonLink, EmptyState, Field, Input, Notice, Loading, LoadError, PageHeader, Panel, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface Detail {
  facility: { id: string; name: string; type: string; region: string | null; district: string | null; ghsCode: string | null; status: string; accessNote: string | null; active: boolean; createdAt: string; trialEndsAt: string | null };
  administrator: { name: string | null; email: string; phone: string | null } | null;
  subscription: { plan: string; status: string; cycle: string; periodEnd: string | null } | null;
  health: { state: string; why: string[] };
  usage: { rosters: { year: number; month: number; status: string; publishedAt: string | null; attendanceCompleteness: number | null; version: number }[]; accountsActive: number; staffActive: number; lastSignInAt: string | null; rostersThisMonth: number; rostersLastMonth: number };
  billing: { invoices: { id: string; number: string; issuedAt: string; dueAt: string | null; totalGhs: number; status: string; paidAt: string | null }[]; outstandingGhs: number };
  configuration: {
    shifts: { name: string; code: string; startTime: string | null; endTime: string | null; minStaff: number; countsAsDuty: boolean }[];
    cadres: string[];
    rules: { code: string; name: string; thresholdValue: number | null; unit: string | null; behaviour: string; enabled: boolean }[];
    cycles: { name: string; consecutiveDuties: number; offDaysRequired: number; enforcement: string; active: boolean }[];
  };
  activity: { id: string; createdAt: string; actorEmail: string | null; action: string; summary: string }[];
  supportSessions: { id: string; by: string; reason: string; level: string; startedAt: string; endedAt: string | null }[];
}

const STATE_WORD: Record<string, string> = {
  PENDING: "Waiting for approval", DECLINED: "Declined", TRIAL: "On trial", ACTIVE: "Active", LAPSED: "Locked, unpaid", SUSPENDED: "Suspended",
};

/** Approve, decline, suspend, reinstate or extend. Each asks for a reason where the facility will read one. */
function AccessPanel({ f, onDone }: { f: Detail["facility"]; onDone: () => void }) {
  const [mode, setMode] = useState<null | "decline" | "suspend" | "extend">(null);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "block"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(path: string, body: object, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/api/platform/facilities/${f.id}/${path}`, body);
      setMsg({ tone: "success", text: ok });
      setMode(null);
      setReason("");
      onDone();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string; fields?: Record<string, string> }) : undefined;
      setMsg({ tone: "block", text: b?.message ?? (b?.fields ? Object.values(b.fields)[0] : "That did not work. Try again.") });
    } finally { setBusy(false); }
  }
  const s = f.status;
  return (
    <Panel title="Access" description="Whether this facility and its staff can use HealthFlow.">
      <p className="mb-3 text-[15px]"><StatusBadge tone={s === "ACTIVE" ? "success" : s === "TRIAL" ? "neutral" : s === "PENDING" ? "warning" : "block"}>{STATE_WORD[s] ?? s.toLowerCase()}</StatusBadge>{f.accessNote && <span className="ml-2 text-[var(--muted)]">{f.accessNote}</span>}</p>
      {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {(s === "PENDING" || s === "DECLINED") && <Button disabled={busy} onClick={() => go("approve", {}, "Approved. The 30 day trial has started.")}>Approve and start trial</Button>}
          {s === "PENDING" && <Button variant="secondary" onClick={() => setMode("decline")}>Decline</Button>}
          {s !== "PENDING" && s !== "DECLINED" && s !== "SUSPENDED" && <Button variant="secondary" onClick={() => setMode("suspend")}>Suspend</Button>}
          {s === "SUSPENDED" && <Button disabled={busy} onClick={() => go("reactivate", {}, "Reinstated.")}>Reinstate</Button>}
          {s !== "PENDING" && s !== "DECLINED" && <Button variant="secondary" onClick={() => setMode("extend")}>{s === "LAPSED" ? "Open until a date" : "Extend access"}</Button>}
        </div>
      ) : (
        <div className="max-w-lg space-y-3">
          {mode === "extend" && <Field label="Access runs to">{(a) => <Input {...a} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>}
          <Field label={mode === "extend" ? "Why? For example, paid by cheque, or goodwill" : mode === "suspend" ? "Why? The facility will see this" : "Why is it not approved? The facility will read this"}>{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button variant={mode === "extend" ? "primary" : "danger"} disabled={busy} onClick={() => go(mode, mode === "extend" ? { until, reason } : { reason }, mode === "extend" ? "Access extended." : mode === "suspend" ? "Suspended. Reading and export stay open." : "Declined.")}>
              {mode === "extend" ? "Extend access" : mode === "suspend" ? "Suspend" : "Decline registration"}
            </Button>
            <Button variant="quiet" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

const TABS = ["Overview", "Usage", "Billing", "Configuration", "Activity"] as const;
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export default function FacilityDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useResource<Detail>(`/api/platform/facilities/${id}`);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading the facility" />;
  const f = data.facility;
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/platform/facilities" className="text-[var(--accent-text)] underline underline-offset-2">Facilities</Link>
      </p>
      <PageHeader title={f.name} description={[f.district, f.region].filter(Boolean).join(", ")} actions={<><ButtonLink href={`/platform/facilities/new?facility=${f.id}`} variant="secondary">Set up this facility</ButtonLink><StatusBadge tone={HEALTH_TONE[data.health.state]}>{HEALTH_WORD[data.health.state]}</StatusBadge></>} />
      <div role="tablist" aria-label="Facility" className="mb-5 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`min-h-11 px-4 text-[15px] ${tab === t ? "border-b-2 border-[var(--accent)] font-medium text-[var(--accent-text)]" : "text-[var(--muted)]"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="space-y-6">
          <AccessPanel f={f} onDone={reload} />
          <Panel title="Profile">
            <dl className="divide-y divide-[var(--border)]">
              <Row k="Type">{f.type.replace(/_/g, " ").toLowerCase()}</Row>
              <Row k="GHS facility code">{f.ghsCode ?? "Not set"}</Row>
              <Row k="Status">{f.status.toLowerCase()}{f.trialEndsAt ? `, trial ends ${showDate(f.trialEndsAt)}` : ""}</Row>
              <Row k="Plan">{data.subscription ? `${data.subscription.plan}, ${data.subscription.status.replace(/_/g, " ").toLowerCase()}, ${data.subscription.cycle.toLowerCase()}` : "No subscription yet"}</Row>
              <Row k="Created">{showDate(f.createdAt)}</Row>
              <Row k="Facility administrator">{data.administrator ? [data.administrator.name, data.administrator.email, data.administrator.phone].filter(Boolean).join(" · ") : "None yet"}</Row>
            </dl>
          </Panel>
          <Panel title="Health" description="Worked out from what the facility does.">
            <ul className="list-disc space-y-1 pl-5">
              {data.health.why.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Panel>
          <Panel title="Support access" description="Every time PS Tech has looked at this facility's data. The facility sees the same list.">
            {data.supportSessions.length === 0 ? (
              <p className="text-[var(--muted)]">Never.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.supportSessions.map((s) => (
                  <li key={s.id} className="py-2">
                    <p>{s.by}, {s.level === "READ_ONLY" ? "read only" : "full access"}, {showDateTime(s.startedAt)}</p>
                    <p className="text-sm text-[var(--muted)]">{s.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === "Usage" && (
        <div className="space-y-6">
          <dl className="figures grid gap-3 sm:grid-cols-4">
            {[["Staff accounts active", `${data.usage.accountsActive} of ${data.usage.staffActive}`], ["Rosters published this month", String(data.usage.rostersThisMonth)], ["Last month", String(data.usage.rostersLastMonth)], ["Last sign-in", data.usage.lastSignInAt ? showDate(data.usage.lastSignInAt) : "Never"]].map(([k, v]) => (
              <div key={k} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <dt className="text-sm text-[var(--muted)]">{k}</dt>
                <dd className="text-lg font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          {data.usage.rosters.length === 0 ? (
            <EmptyState title="No rosters yet" />
          ) : (
            <TableScroll label="Rosters by month">
              <table className="w-full min-w-[32rem] border-collapse text-[15px]">
                <thead><tr>{["Month", "Status", "Published", "Attendance recorded", "Versions"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.usage.rosters.map((r) => (
                    <tr key={`${r.year}-${r.month}`}>
                      <th scope="row" className={`${TD} text-left font-medium`}>{MONTH[r.month - 1]} {r.year}</th>
                      <td className={TD}>{r.status.replace(/_/g, " ").toLowerCase()}</td>
                      <td className={`${TD} figures`}>{r.publishedAt ? showDate(r.publishedAt) : ""}</td>
                      <td className={`${TD} figures`}>{r.attendanceCompleteness === null ? "" : `${Math.round(r.attendanceCompleteness * 100)}%`}</td>
                      <td className={`${TD} figures`}>{r.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      )}

      {tab === "Billing" && (
        <div className="space-y-4">
          <p className="figures text-lg">Outstanding: <strong>{cedi(data.billing.outstandingGhs)}</strong></p>
          {data.billing.invoices.length === 0 ? (
            <EmptyState title="No invoices yet" />
          ) : (
            <TableScroll label="Invoices">
              <table className="w-full min-w-[32rem] border-collapse text-[15px]">
                <thead><tr>{["Invoice", "Issued", "Due", "Total", "Status"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.billing.invoices.map((i) => (
                    <tr key={i.id}>
                      <th scope="row" className={`${TD} text-left font-medium`}>{i.number}</th>
                      <td className={`${TD} figures`}>{showDate(i.issuedAt)}</td>
                      <td className={`${TD} figures`}>{i.dueAt ? showDate(i.dueAt) : ""}</td>
                      <td className={`${TD} figures`}>{cedi(i.totalGhs)}</td>
                      <td className={TD}>{i.status.replace(/_/g, " ").toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      )}

      {tab === "Configuration" && (
        <div className="space-y-6">
          <p className="text-sm text-[var(--muted)]">Read only. This is how the facility has set itself up, shown without opening the facility. No staff records are shown here.</p>
          <Panel title="Shifts">
            <ul className="divide-y divide-[var(--border)]">
              {data.configuration.shifts.map((s) => (
                <li key={s.code} className="figures py-2">{s.name} ({s.code}) {s.startTime ? `${s.startTime} to ${s.endTime}` : ""}{s.countsAsDuty ? `, needs ${s.minStaff}` : ", not a duty"}</li>
              ))}
              {data.configuration.shifts.length === 0 && <li className="py-2 text-[var(--muted)]">None set up.</li>}
            </ul>
          </Panel>
          <Panel title="Cadres"><p>{data.configuration.cadres.join(", ") || "None set up."}</p></Panel>
          <Panel title="Compliance rules">
            <ul className="divide-y divide-[var(--border)]">
              {data.configuration.rules.map((r) => (
                <li key={r.code} className="figures flex flex-wrap justify-between gap-2 py-2">
                  <span>{r.code} {r.name}</span>
                  <span className="text-[var(--muted)]">{r.thresholdValue ?? ""} {r.unit ?? ""} · {r.behaviour.toLowerCase()}{r.enabled ? "" : " · off"}</span>
                </li>
              ))}
              {data.configuration.rules.length === 0 && <li className="py-2 text-[var(--muted)]">Defaults, not yet opened.</li>}
            </ul>
          </Panel>
          <Panel title="Duty cycles">
            <ul className="divide-y divide-[var(--border)]">
              {data.configuration.cycles.map((c) => (
                <li key={c.name} className="py-2">{c.name}: {c.consecutiveDuties} on, {c.offDaysRequired} off, {c.enforcement.toLowerCase()}{c.active ? "" : ", off"}</li>
              ))}
              {data.configuration.cycles.length === 0 && <li className="py-2 text-[var(--muted)]">None set up.</li>}
            </ul>
          </Panel>
        </div>
      )}

      {tab === "Activity" && (
        <Panel title="The facility's audit log" description="The latest 100 entries.">
          <ul className="divide-y divide-[var(--border)]">
            {data.activity.map((a) => (
              <li key={a.id} className="py-2">
                <p>{a.summary}</p>
                <p className="figures text-sm text-[var(--muted)]">{showDateTime(a.createdAt)}{a.actorEmail ? ` · ${a.actorEmail}` : ""}</p>
              </li>
            ))}
            {data.activity.length === 0 && <li className="py-2 text-[var(--muted)]">Nothing yet.</li>}
          </ul>
        </Panel>
      )}
    </>
  );
}
