"use client";

import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
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

export default function PrivacyPage() {
  const { isAdmin } = useFacility();
  if (!isAdmin) return <Notice tone="warning">Only facility admins can manage privacy and data protection.</Notice>;
  return (
    <>
      <PageHeader title="Privacy and data protection" description="The notice your staff accept, and how long each kind of record is kept." />
      <div className="space-y-6">
        <NoticePanel />
        <RetentionPanel />
      </div>
    </>
  );
}
