"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

const cedi = (n: number) => `GH₵ ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TABS = ["Invoices", "Subscriptions", "Plans", "Revenue"] as const;
const THIS_MONTH = () => new Date().toISOString().slice(0, 7);
const fail = (e: unknown, fallback = "That did not work. Try again.") => {
  const b = e instanceof ApiError ? (e.body as { message?: string; fields?: Record<string, string> }) : undefined;
  return b?.message ?? (b?.fields ? Object.values(b.fields)[0] : fallback);
};

interface Inv { id: string; number: string; facility: string; issuedAt: string; dueAt: string | null; totalGhs: number; status: string; overdue: boolean; paidAt: string | null; paymentMethod: string | null }

function Invoices({ say }: { say: (m: { tone: "success" | "block"; text: string } | null) => void }) {
  const { data, error, reload } = useResource<{ invoices: Inv[]; outstandingGhs: number; overdueGhs: number }>("/api/platform/invoices");
  const [month, setMonth] = useState(THIS_MONTH());
  const [preview, setPreview] = useState<{ facility: string; totalGhs: number; already: boolean }[] | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [ref, setRef] = useState("");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;

  async function show() {
    say(null);
    try { setPreview((await api.get<{ items: { facility: string; totalGhs: number; already: boolean }[] }>(`/api/platform/invoices/preview?month=${month}`)).items); } catch (e) { say({ tone: "block", text: fail(e) }); }
  }
  async function issue() {
    try {
      const r = await api.post<{ issued: number; skipped: number }>("/api/platform/invoices/generate", { month });
      say({ tone: "success", text: `${r.issued} invoices issued, ${r.skipped} skipped because they already exist.` });
      setPreview(null);
      reload();
    } catch (e) { say({ tone: "block", text: fail(e) }); }
  }
  async function pay(id: string) {
    try { await api.post(`/api/platform/invoices/${id}/payment`, { method, reference: ref }); setPaying(null); setRef(""); say({ tone: "success", text: "Payment recorded." }); reload(); } catch (e) { say({ tone: "block", text: fail(e) }); }
  }
  async function writeOff(id: string) {
    const reason = window.prompt("Reason for writing this invoice off");
    if (!reason) return;
    try { await api.post(`/api/platform/invoices/${id}/write-off`, { reason }); reload(); } catch (e) { say({ tone: "block", text: fail(e) }); }
  }
  async function mail(id: string) {
    try { const r = await api.post<{ emailed: boolean }>(`/api/platform/invoices/${id}/email`, {}); say({ tone: r.emailed ? "success" : "block", text: r.emailed ? "Emailed to the facility administrator." : "Email is not set up, so nothing was sent. Download the PDF and send it yourself." }); } catch (e) { say({ tone: "block", text: fail(e) }); }
  }

  return (
    <div className="space-y-6">
      <p className="text-[15px]">Outstanding {cedi(data.outstandingGhs)}. Overdue <strong>{cedi(data.overdueGhs)}</strong>.</p>
      <Panel title="Issue the month's invoices">
        <div className="flex flex-wrap items-end gap-3">
          <div className="max-w-[12rem]"><Field label="Month">{(a) => <Input {...a} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}</Field></div>
          <Button variant="secondary" onClick={show}>Preview</Button>
        </div>
        {preview && (
          <div className="mt-4">
            {preview.length === 0 ? <p className="text-[15px]">No active subscriptions to bill.</p> : (
              <ul className="text-[15px]">{preview.map((p) => <li key={p.facility} className="flex justify-between gap-4 py-1"><span>{p.facility}{p.already && <span className="text-[var(--muted)]"> (already issued)</span>}</span><span className="figures">{cedi(p.totalGhs)}</span></li>)}</ul>
            )}
            <div className="mt-3"><Button onClick={issue} disabled={preview.every((p) => p.already)}>Issue these invoices</Button></div>
          </div>
        )}
      </Panel>
      {data.invoices.length === 0 ? <EmptyState title="No invoices yet" /> : (
        <TableScroll label="Invoices">
          <table className="w-full min-w-[52rem] border-collapse text-[15px]">
            <thead><tr>{["Number", "Facility", "Issued", "Due", "Amount", "Status", ""].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {data.invoices.map((i) => (
                <tr key={i.id}>
                  <th scope="row" className={`${TD} figures text-left font-medium`}>{i.number}</th>
                  <td className={TD}>{i.facility}</td>
                  <td className={`${TD} figures`}>{showDate(i.issuedAt)}</td>
                  <td className={`${TD} figures`}>{i.dueAt ? showDate(i.dueAt) : ""}</td>
                  <td className={`${TD} figures`}>{cedi(i.totalGhs)}</td>
                  <td className={TD}><StatusBadge tone={i.status === "PAID" ? "success" : i.overdue ? "block" : "neutral"}>{i.overdue ? "Overdue" : i.status.replace("_", " ").toLowerCase()}</StatusBadge></td>
                  <td className={TD}>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => api.download(`/api/platform/invoices/${i.id}/pdf`, `${i.number}.pdf`)}>PDF</Button>
                      <Button variant="secondary" onClick={() => mail(i.id)}>Email</Button>
                      {["ISSUED", "OVERDUE"].includes(i.status) && <><Button onClick={() => setPaying(i.id)}>Record payment</Button><Button variant="secondary" onClick={() => writeOff(i.id)}>Write off</Button></>}
                    </div>
                    {paying === i.id && (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <Select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} className="w-44"><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_MONEY">Mobile Money</option><option value="CASH">Cash</option><option value="OTHER">Other</option></Select>
                        <Input aria-label="Reference" placeholder="Reference" value={ref} onChange={(e) => setRef(e.target.value)} className="w-44" />
                        <Button onClick={() => pay(i.id)} disabled={ref.trim().length < 2}>Save</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

interface Sub { id: string; facilityId: string; facility: string; plan: string; monthlyPriceGhs: number; status: string; billingCycle: string; currentPeriodEnd: string | null; renewingSoon: boolean }
interface PlanRow { id: string; name: string; monthlyPriceGhs: number; setupPriceGhs: number | null; staffBandMin: number | null; staffBandMax: number | null; active: boolean; subscribers: number }

function Subscriptions({ say }: { say: (m: { tone: "success" | "block"; text: string } | null) => void }) {
  const subs = useResource<{ subscriptions: Sub[] }>("/api/platform/subscriptions");
  const plans = useResource<{ plans: PlanRow[] }>("/api/platform/plans");
  const facs = useResource<{ facilities: { id: string; name: string }[] }>("/api/platform/facilities");
  const [facilityId, setFacilityId] = useState("");
  const [planId, setPlanId] = useState("");
  const [cycle, setCycle] = useState("MONTHLY");
  const [status, setStatus] = useState("ACTIVE");
  if (!subs.data || !plans.data || !facs.data) return <Loading />;

  async function save(e: FormEvent) {
    e.preventDefault();
    try { await api.put(`/api/platform/facilities/${facilityId}/subscription`, { planId, billingCycle: cycle, status }); say({ tone: "success", text: "Subscription saved." }); subs.reload(); } catch (err) { say({ tone: "block", text: fail(err) }); }
  }
  async function suspend(id: string) {
    const reason = window.prompt("Reason for suspending. Reading and export stay open.");
    if (!reason) return;
    try { await api.post(`/api/platform/facilities/${id}/suspend`, { reason }); subs.reload(); } catch (err) { say({ tone: "block", text: fail(err) }); }
  }
  async function reactivate(id: string) {
    try { await api.post(`/api/platform/facilities/${id}/reactivate`, {}); subs.reload(); } catch (err) { say({ tone: "block", text: fail(err) }); }
  }
  return (
    <div className="space-y-6">
      <Panel title="Start or change a subscription">
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <Field label="Facility">{(a) => <Select {...a} value={facilityId} onChange={(e) => setFacilityId(e.target.value)} required><option value="">Choose</option>{facs.data!.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
          <Field label="Plan">{(a) => <Select {...a} value={planId} onChange={(e) => setPlanId(e.target.value)} required><option value="">Choose</option>{plans.data!.plans.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}, {cedi(p.monthlyPriceGhs)}</option>)}</Select>}</Field>
          <Field label="Cycle">{(a) => <Select {...a} value={cycle} onChange={(e) => setCycle(e.target.value)}><option value="MONTHLY">Monthly</option><option value="ANNUAL">Annual</option></Select>}</Field>
          <Field label="State">{(a) => <Select {...a} value={status} onChange={(e) => setStatus(e.target.value)}><option value="ACTIVE">Active</option><option value="TRIAL">Trial</option></Select>}</Field>
          <Button type="submit">Save</Button>
        </form>
        {plans.data.plans.length === 0 && <p className="mt-3 text-sm text-[var(--muted)]">Create a plan first, under Plans.</p>}
      </Panel>
      {subs.data.subscriptions.length === 0 ? <EmptyState title="No subscriptions yet" /> : (
        <TableScroll label="Subscriptions">
          <table className="w-full min-w-[44rem] border-collapse text-[15px]">
            <thead><tr>{["Facility", "Plan", "State", "Cycle", "Renews", ""].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {subs.data.subscriptions.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className={`${TD} text-left font-medium`}>{s.facility}</th>
                  <td className={TD}>{s.plan}</td>
                  <td className={TD}><StatusBadge tone={s.status === "ACTIVE" ? "success" : s.status === "TRIAL" ? "neutral" : "block"}>{s.status.replace("_", " ").toLowerCase()}</StatusBadge></td>
                  <td className={TD}>{s.billingCycle.toLowerCase()}</td>
                  <td className={`${TD} figures`}>{s.currentPeriodEnd ? showDate(s.currentPeriodEnd) : ""}{s.renewingSoon && <span className="ml-2 text-sm text-[var(--status-warning)]">within 30 days</span>}</td>
                  <td className={TD}>{s.status === "SUSPENDED" ? <Button variant="secondary" onClick={() => reactivate(s.facilityId)}>Reactivate</Button> : <Button variant="secondary" onClick={() => suspend(s.facilityId)}>Suspend</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

function Plans({ say }: { say: (m: { tone: "success" | "block"; text: string } | null) => void }) {
  const { data, error, reload } = useResource<{ plans: PlanRow[]; billing: { bankConfigured: boolean; termsDays: number } }>("/api/platform/plans");
  const [f, setF] = useState({ name: "", monthly: "", setup: "", min: "", max: "" });
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/api/platform/plans", { name: f.name, monthlyPriceGhs: Number(f.monthly), setupPriceGhs: f.setup ? Number(f.setup) : null, staffBandMin: f.min ? Number(f.min) : null, staffBandMax: f.max ? Number(f.max) : null });
      setF({ name: "", monthly: "", setup: "", min: "", max: "" });
      say({ tone: "success", text: "Plan created." });
      reload();
    } catch (err) { say({ tone: "block", text: fail(err) }); }
  }
  async function retire(p: PlanRow) { try { await api.patch(`/api/platform/plans/${p.id}`, { active: !p.active }); reload(); } catch (err) { say({ tone: "block", text: fail(err) }); } }
  return (
    <div className="space-y-6">
      {!data.billing.bankConfigured && <Notice tone="warning">Bank details are not set. Invoices say that details are given on request. Set BILLING_BANK_NAME, BILLING_ACCOUNT_NAME and BILLING_ACCOUNT_NUMBER on the API.</Notice>}
      <Panel title="New plan">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />}</Field>
          <Field label="Monthly price (GH₵)">{(a) => <Input {...a} type="number" min={0} step="0.01" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} required />}</Field>
          <Field label="Setup price (GH₵)" optional>{(a) => <Input {...a} type="number" min={0} step="0.01" value={f.setup} onChange={(e) => setF({ ...f, setup: e.target.value })} />}</Field>
          <Field label="Staff from" optional>{(a) => <Input {...a} type="number" min={0} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />}</Field>
          <Field label="Staff up to" optional>{(a) => <Input {...a} type="number" min={0} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />}</Field>
          <Button type="submit">Create plan</Button>
        </form>
      </Panel>
      {data.plans.length === 0 ? <EmptyState title="No plans yet">The public pricing page shows nothing until a plan is added.</EmptyState> : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 text-[15px]">
          {data.plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                <strong>{p.name}</strong> {cedi(p.monthlyPriceGhs)} a month{p.setupPriceGhs ? `, setup ${cedi(p.setupPriceGhs)}` : ""}
                <span className="block text-sm text-[var(--muted)]">{p.staffBandMin !== null || p.staffBandMax !== null ? `${p.staffBandMin ?? 0} to ${p.staffBandMax ?? "any number of"} staff. ` : ""}{p.subscribers} {p.subscribers === 1 ? "facility" : "facilities"}{p.active ? "" : ". Retired"}</span>
              </span>
              <Button variant="secondary" onClick={() => retire(p)}>{p.active ? "Retire" : "Offer again"}</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Revenue() {
  const { data, error, reload } = useResource<{ mrrGhs: number; activeSubscriptions: number; newThisMonth: number; cancelledTotal: number; receivablesGhs: number; trend: { month: string; receivedGhs: number }[] }>("/api/platform/revenue");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;
  const max = Math.max(1, ...data.trend.map((t) => t.receivedGhs));
  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["Monthly recurring revenue", cedi(data.mrrGhs)], ["Active subscriptions", String(data.activeSubscriptions)], ["Started this month", String(data.newThisMonth)], ["Receivables", cedi(data.receivablesGhs)]].map(([k, v]) => (
          <div key={k} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"><dt className="text-sm text-[var(--muted)]">{k}</dt><dd className="figures text-xl font-semibold">{v}</dd></div>
        ))}
      </dl>
      <Panel title="Received, last six months">
        <ul className="space-y-1 text-sm">
          {data.trend.map((t) => (
            <li key={t.month} className="grid grid-cols-[5rem_1fr_9rem] items-center gap-3">
              <span className="figures">{t.month}</span>
              <span className="h-3 rounded-[2px] bg-[var(--accent-soft)]"><span className="block h-3 rounded-[2px] bg-[var(--accent)]" style={{ width: `${(t.receivedGhs / max) * 100}%` }} /></span>
              <span className="figures text-right">{cedi(t.receivedGhs)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export default function BillingConsole() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Invoices");
  const [msg, setMsg] = useState<{ tone: "success" | "block"; text: string } | null>(null);
  return (
    <>
      <PageHeader title="Billing" description="Plans, subscriptions, invoices and payments. Nothing here deletes anything: invoices are written off, plans are retired, facilities are suspended." />
      <div role="tablist" aria-label="Billing" className="mb-5 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setMsg(null); }} className={`min-h-11 px-4 text-[15px] ${tab === t ? "border-b-2 border-[var(--accent)] font-medium text-[var(--accent-text)]" : "text-[var(--muted)]"}`}>{t}</button>
        ))}
      </div>
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {tab === "Invoices" && <Invoices say={setMsg} />}
      {tab === "Subscriptions" && <Subscriptions say={setMsg} />}
      {tab === "Plans" && <Plans say={setMsg} />}
      {tab === "Revenue" && <Revenue />}
    </>
  );
}
