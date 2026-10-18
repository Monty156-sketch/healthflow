"use client";

import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate, showDateTime } from "@/lib/format";
import {
  Button,
  Field,
  Input,
  Loading,
  LoadError,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  TD,
  TH,
  TableScroll,
  Textarea,
} from "@/components/ui";

interface NoticeRow {
  id: string;
  version: string;
  body: string;
  publishedAt: string;
  publishedBy: string | null;
}

function messageOf(err: unknown, fallback: string) {
  const body = err instanceof ApiError ? (err.body as { message?: string; fields?: Record<string, string> }) : undefined;
  return body?.fields?.body ?? body?.message ?? fallback;
}

function NoticePanel() {
  const { data, error, reload } = useResource<{ notices: NoticeRow[]; template: string }>("/api/facility/privacy/notices");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showOld, setShowOld] = useState(false);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;
  const current = data.notices[0];

  async function publish() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await api.post<{ notice: NoticeRow }>("/api/facility/privacy/notices", { body: draft });
      setDraft(null);
      setDone(`Version ${res.notice.version} is published. New invitations will show it.`);
      reload();
    } catch (err) {
      setProblem(messageOf(err, "The notice could not be published. Your text is still here; try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Privacy notice"
      description="What staff read and accept when they join. Each publication is kept as a new version."
      actions={
        draft === null && (
          <Button onClick={() => setDraft(current ? current.body : data.template)}>
            {current ? "Write a new version" : "Write your notice"}
          </Button>
        )
      }
    >
      {done && draft === null && (
        <div className="mb-4">
          <Notice tone="success">{done}</Notice>
        </div>
      )}
      {draft !== null ? (
        <div className="space-y-3">
          {!current && (
            <p className="text-sm text-[var(--muted)]">
              This starting text is a draft only. Read it, change what does not fit your facility, and replace the line in square brackets with your data
              protection contact.
            </p>
          )}
          <Field label="Notice text" hint="Plain language. Staff will read exactly this.">
            {(a) => <Textarea {...a} rows={18} value={draft} onChange={(e) => setDraft(e.target.value)} />}
          </Field>
          {problem && <Notice tone="block">{problem}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={publish}>
              {busy ? "Publishing…" : "Publish this notice"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setDraft(null); setProblem(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : current ? (
        <>
          <p className="text-sm">
            <StatusBadge tone="success">Published</StatusBadge>{" "}
            <span className="text-[var(--muted)]">
              Version <span className="figures">{current.version}</span>, <span className="figures">{showDateTime(current.publishedAt)}</span>
              {current.publishedBy ? `, by ${current.publishedBy}` : ""}
            </span>
          </p>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-3 text-[15px] leading-relaxed whitespace-pre-wrap" tabIndex={0} role="region" aria-label="Current privacy notice">
            {current.body}
          </div>
          {data.notices.length > 1 && (
            <div className="mt-4">
              <Button variant="quiet" className="-ml-3" aria-expanded={showOld} onClick={() => setShowOld((v) => !v)}>
                {showOld ? "Hide earlier versions" : `Earlier versions (${data.notices.length - 1})`}
              </Button>
              {showOld && (
                <ul className="mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                  {data.notices.slice(1).map((n) => (
                    <li key={n.id} className="py-2">
                      <details>
                        <summary className="flex min-h-11 cursor-pointer items-center">
                          Version <span className="figures mx-1">{n.version}</span>, <span className="figures ml-1">{showDateTime(n.publishedAt)}</span>
                        </summary>
                        <div className="mt-1 mb-2 rounded-[var(--radius)] bg-[var(--background)] p-3 text-[15px] leading-relaxed whitespace-pre-wrap">{n.body}</div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      ) : (
        <Notice tone="warning">
          No notice is published yet. Staff cannot be invited until you publish one, because they read and accept it when they join.
        </Notice>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------- retention

interface Policy {
  id: string;
  entityType: string;
  label: string;
  retentionMonths: number;
  basisNote: string | null;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
}

function months(n: number) {
  if (n % 12 === 0) return `${n / 12} ${n / 12 === 1 ? "year" : "years"}`;
  return `${n} months`;
}

function RetentionRow({ p, onChanged }: { p: Policy; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(p.retentionMonths));
  const [note, setNote] = useState(p.basisNote ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      setEditing(false);
      onChanged();
    } catch (err) {
      setProblem(messageOf(err, "This could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className={TD}>
        <span className="font-medium">{p.label}</span>
        {p.basisNote && !editing && <span className="block text-sm text-[var(--muted)]">{p.basisNote}</span>}
      </td>
      <td className={TD}>
        {editing ? (
          <div className="min-w-56 space-y-2">
            <Field label="Months">
              {(a) => <Input {...a} inputMode="numeric" className="figures" value={value} onChange={(e) => setValue(e.target.value)} />}
            </Field>
            <Field label="Basis" optional>
              {(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            {problem && <p className="text-sm text-[var(--status-block)]">{problem}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  act(() => api.patch(`/api/facility/privacy/retention/${p.id}`, { retentionMonths: Number(value), basisNote: note || null }))
                }
              >
                Save
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <span className="figures whitespace-nowrap">{months(p.retentionMonths)}</span>
        )}
      </td>
      <td className={TD}>
        {p.approved ? (
          <>
            <StatusBadge tone="success">Approved</StatusBadge>
            <span className="mt-1 block text-sm text-[var(--muted)]">
              {p.approvedBy}, <span className="figures">{showDateTime(p.approvedAt)}</span>
            </span>
          </>
        ) : (
          <StatusBadge tone="warning">Proposed, not approved</StatusBadge>
        )}
      </td>
      <td className={TD}>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            {!p.approved && (
              <Button variant="secondary" disabled={busy} onClick={() => act(() => api.post(`/api/facility/privacy/retention/${p.id}/approve`))}>
                Approve
              </Button>
            )}
            <Button variant="quiet" onClick={() => setEditing(true)}>
              Change
            </Button>
          </div>
        )}
        {!editing && problem && <p className="mt-1 text-sm text-[var(--status-block)]">{problem}</p>}
      </td>
    </tr>
  );
}

function RetentionPanel() {
  const { data, error, reload } = useResource<{ policies: Policy[] }>("/api/facility/privacy/retention");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;
  const open = data.policies.filter((p) => !p.approved).length;
  return (
    <Panel
      title="How long records are kept"
      description="HealthFlow proposes these periods. They are not rules for your facility until you approve them."
    >
      <div className="mb-4">
        <Notice tone="warning">
          These periods are proposals, not legal advice. Check them against the Data Protection Act, 2012 (Act 843), the Labour Act and your own
          facility&apos;s obligations, and change any that do not fit. Nothing is deleted automatically yet.
        </Notice>
      </div>
      {open > 0 && <p className="mb-3 text-sm text-[var(--muted)]">{open} of {data.policies.length} periods still need your approval.</p>}
      <TableScroll label="Retention periods">
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              <th className={TH}>Records</th>
              <th className={TH}>Kept for</th>
              <th className={TH}>Status</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.policies.map((p) => (
              <RetentionRow key={p.id + p.retentionMonths + String(p.approved)} p={p} onChanged={reload} />
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  );
}


interface Dsr {
  id: string; staff: string; type: string; description: string | null; status: string; receivedAt: string; dueAt: string | null;
  daysLeft: number | null; overdue: boolean; completedAt: string | null; outcomeNote: string | null;
}
interface Plan { erase: { what: string }[]; retain: { what: string; why: string }[] }
const DSR_WORD: Record<string, string> = { CORRECTION: "Correction", OBJECTION: "Objection", ERASURE: "Erasure", ACCESS: "Access", PORTABILITY: "Portability" };

function RequestRow({ r, onChanged }: { r: Dsr; onChanged: () => void }) {
  const [mode, setMode] = useState<null | "answer" | "refuse" | "erase">(null);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const open = r.status === "RECEIVED" || r.status === "IN_PROGRESS";

  async function show(m: "answer" | "refuse" | "erase") {
    setMode(m);
    setProblem(null);
    if (m === "erase") {
      try {
        setPlan((await api.get<{ plan: Plan }>(`/api/facility/privacy/requests/${r.id}/erasure-plan`)).plan);
      } catch {
        setProblem("The plan could not be worked out.");
      }
    }
  }
  async function submit() {
    setProblem(null);
    try {
      if (mode === "erase") await api.post(`/api/facility/privacy/requests/${r.id}/erase`, {});
      else if (mode === "refuse") await api.post(`/api/facility/privacy/requests/${r.id}/refuse`, { reason: text });
      else await api.post(`/api/facility/privacy/requests/${r.id}/complete`, { outcomeNote: text });
      setMode(null);
      onChanged();
    } catch (e) {
      setProblem(messageOf(e, "It was not saved. Try again."));
    }
  }
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{r.staff}</strong>
        <span>{DSR_WORD[r.type]}</span>
        {open ? (
          <StatusBadge tone={r.overdue ? "block" : (r.daysLeft ?? 99) <= 3 ? "warning" : "neutral"}>
            {r.overdue ? `${Math.abs(r.daysLeft ?? 0)} days overdue` : `${r.daysLeft} days left`}
          </StatusBadge>
        ) : (
          <StatusBadge tone={r.status === "COMPLETED" ? "success" : "warning"}>{r.status === "COMPLETED" ? "Answered" : "Not granted"}</StatusBadge>
        )}
        <span className="text-sm text-[var(--muted)]">Received {showDateTime(r.receivedAt)}</span>
      </div>
      {r.description && <p className="mt-1 text-[15px]">{r.description}</p>}
      {r.outcomeNote && <p className="mt-1 text-[15px] text-[var(--muted)]">{r.outcomeNote}</p>}
      {open && !mode && (
        <div className="mt-2 flex flex-wrap gap-2">
          {r.type === "ERASURE" ? <Button onClick={() => show("erase")}>Review what can be erased</Button> : <Button onClick={() => show("answer")}>Record the answer</Button>}
          <Button variant="secondary" onClick={() => show("refuse")}>Refuse, with a reason</Button>
        </div>
      )}
      {mode === "erase" && plan && (
        <div className="mt-3 space-y-2 text-[15px]">
          <p className="font-medium">Will be erased</p>
          <ul className="list-disc pl-5">{plan.erase.map((e) => <li key={e.what}>{e.what}</li>)}</ul>
          <p className="font-medium">Must be kept, and why</p>
          <ul className="list-disc pl-5">{plan.retain.map((e) => <li key={e.what}>{e.what}. {e.why}</li>)}</ul>
          <p className="text-[var(--muted)]">The person is told exactly this.</p>
          <div className="flex gap-2"><Button onClick={submit}>Erase and tell them</Button><Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button></div>
        </div>
      )}
      {(mode === "answer" || mode === "refuse") && (
        <div className="mt-3 max-w-xl space-y-2">
          <Field label={mode === "refuse" ? "Reason for refusing (the person is shown this)" : "What was done (the person is shown this)"}>{(a) => <Textarea {...a} rows={3} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
          <div className="flex gap-2"><Button onClick={submit} disabled={text.trim().length < 10}>Send</Button><Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button></div>
        </div>
      )}
      {problem && <p className="mt-1 text-sm text-[var(--status-block)]">{problem}</p>}
    </li>
  );
}

function RequestsPanel() {
  const { data, error, reload } = useResource<{ requests: Dsr[] }>("/api/facility/privacy/requests");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;
  const sorted = [...data.requests].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
  return (
    <Panel title="Requests from staff" description="Corrections and objections are due in 14 days, erasure in 30. Access and portability are answered at once by the download on each person's My data page.">
      {sorted.length === 0 ? <p className="text-[15px] text-[var(--muted)]">No requests.</p> : <ul className="divide-y divide-[var(--border)]">{sorted.map((r) => <RequestRow key={r.id} r={r} onChanged={reload} />)}</ul>}
    </Panel>
  );
}

interface Due { entityType: string; label: string; months: number; cutoff: string; count: number; removable: boolean; note: string | null }

function DuePanel() {
  const { data, error, reload } = useResource<{ expired: Due[] }>("/api/facility/privacy/retention-due");
  const [msg, setMsg] = useState<string | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;
  async function confirm(t: string) {
    try {
      const r = await api.post<{ deleted: number }>("/api/facility/privacy/retention-due/confirm", { entityType: t });
      setMsg(`${r.deleted} records deleted and written to the audit log.`);
      reload();
    } catch (e) {
      setMsg(messageOf(e, "Nothing was deleted. Try again."));
    }
  }
  return (
    <Panel title="Records past their period" description="Only periods you have approved are checked. Each month the list is rebuilt and you are told. Nothing is deleted until you confirm it here.">
      {msg && <Notice>{msg}</Notice>}
      {data.expired.length === 0 ? <p className="text-[15px] text-[var(--muted)]">Approve at least one retention period above to see what has expired.</p> : (
        <ul className="divide-y divide-[var(--border)] text-[15px]">
          {data.expired.map((d) => (
            <li key={d.entityType} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                {d.label}
                <span className="block text-sm text-[var(--muted)]">{d.removable ? `${d.count} older than ${showDate(d.cutoff)}` : d.note}</span>
              </span>
              {d.removable && d.count > 0 && <Button variant="secondary" onClick={() => confirm(d.entityType)}>Delete {d.count} now</Button>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ExportPanel() {
  const { data } = useResource<{ entities: { name: string; rows: number }[] }>("/api/facility/privacy/export");
  const [msg, setMsg] = useState<string | null>(null);
  const get = (path: string, name: string) => api.download(path, name).catch(() => setMsg("The file could not be made. Try again."));
  return (
    <Panel title="Export all of your facility's data">
      <p className="mb-3 text-[15px]">You can do this at any time, without a fee and without asking. All data is deleted within 90 days of the agreement ending.</p>
      {msg && <Notice tone="block">{msg}</Notice>}
      <Button onClick={() => get("/api/facility/privacy/export.json", "facility-data.json")}>Download everything (JSON)</Button>
      {data && (
        <ul className="mt-4 grid gap-x-6 sm:grid-cols-2 text-[15px]">
          {data.entities.map((e) => (
            <li key={e.name} className="flex items-center justify-between gap-3 py-1">
              <span>{e.name.replace(/([A-Z])/g, " $1").toLowerCase()} <span className="figures text-[var(--muted)]">({e.rows})</span></span>
              <button type="button" className="min-h-11 px-2 text-[var(--accent-text)] underline-offset-2 hover:underline" onClick={() => get(`/api/facility/privacy/export/${e.name}.csv`, `${e.name}.csv`)}>CSV</button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function PrivacyPage() {
  const { isAdmin } = useFacility();
  if (!isAdmin) return <Notice tone="warning">Only facility admins can manage privacy and data protection.</Notice>;
  return (
    <>
      <PageHeader title="Privacy and data protection" description="The notice your staff accept, and how long each kind of record is kept." />
      <div className="space-y-6">
        <NoticePanel />
        <RequestsPanel />
        <RetentionPanel />
        <DuePanel />
        <ExportPanel />
      </div>
    </>
  );
}
