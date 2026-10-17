"use client";

import { useEffect, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { LeaveDetail, LeaveRequestRow } from "@/lib/types";
import { ReturnActions } from "@/components/ReturnActions";
import { ReinstatePanel } from "@/components/ReinstatePanel";
import { Button, ButtonLink, Checkbox, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, TableScroll, Textarea } from "@/components/ui";

const STATUS: Record<LeaveRequestRow["status"], { word: string; tone: "neutral" | "success" | "warning" | "block" }> = {
  DRAFT: { word: "Draft", tone: "neutral" },
  SUBMITTED: { word: "Awaiting decision", tone: "warning" },
  APPROVED: { word: "Approved", tone: "success" },
  REJECTED: { word: "Rejected", tone: "block" },
  CANCELLED: { word: "Cancelled", tone: "neutral" },
};

const RETURN_WORD: Record<string, string> = {
  NOT_DUE: "Not yet due",
  DUE: "Due back",
  OVERDUE: "Overdue, not confirmed back",
  CONFIRMED: "Back on duty",
  RETURNED_EARLY: "Back early",
  EXTENDED: "Extended",
};

const dayCount = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

const span = (r: { startDate: string; endDate: string }) => (r.startDate === r.endDate ? showDate(r.startDate) : `${showDate(r.startDate)} to ${showDate(r.endDate)}`);

function Detail({ id, decider, myStaffId, onChanged, onClose }: { id: string; decider: boolean; myStaffId: string | null; onChanged: () => void; onClose: () => void }) {
  const { data, error, reload } = useResource<LeaveDetail>(`/api/facility/leave/requests/${id}`);
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [resume, setResume] = useState("");
  const [working, setWorking] = useState<string | null>(null);

  const pending = data?.request;
  const calc = Boolean(pending && decider && pending.status === "SUBMITTED" && !pending.isOpenEnded && pending.returnDateSetBy === "IN_CHARGE");
  useEffect(() => {
    if (!calc || !pending) return;
    let live = true;
    const q = new URLSearchParams({ leaveTypeId: pending.leaveTypeId, startDate: pending.startDate, days: String(dayCount(pending.startDate, pending.endDate)) });
    api.get<{ resumptionDate: string; sentence: string }>(`/api/facility/leave/resumption?${q}`)
      .then((r) => {
        if (!live) return;
        setResume(r.resumptionDate);
        setWorking(r.sentence);
      })
      .catch(() => live && setWorking(null));
    return () => {
      live = false;
    };
  }, [calc, pending]);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading request" />;
  const { request: r, impact, balance, history } = data;
  const open = r.status === "SUBMITTED";
  const mine = Boolean(myStaffId) && r.staffId === myStaffId;

  async function act(path: string, body?: object) {
    setBusy(true);
    setProblem(null);
    setNoteError(null);
    try {
      const res = await api.post<{ warning?: string | null }>(`/api/facility/leave/requests/${id}/${path}`, body);
      if (res.warning) setWarning(res.warning);
      onChanged();
      reload();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { message?: string; fields?: Record<string, string> }) : undefined;
      if (b?.fields?.note) setNoteError(b.fields.note);
      else setProblem(b?.message ?? "That did not work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={`${r.staffName}: ${r.typeName.toLowerCase()} leave`}
      description={`${span(r)}${r.days !== null ? `, ${r.days} ${r.days === 1 ? "day" : "days"}` : ""}`}
      actions={
        <span className="flex items-center gap-2">
          <StatusBadge tone={STATUS[r.status].tone}>{STATUS[r.status].word}</StatusBadge>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </span>
      }
    >
      <dl className="grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-[9rem_1fr]">
        {r.cadreName && (
          <>
            <dt className="text-[var(--muted)]">Cadre</dt>
            <dd>{r.cadreName}</dd>
          </>
        )}
        {r.reason && (
          <>
            <dt className="text-[var(--muted)]">Reason given</dt>
            <dd>{r.reason}</dd>
          </>
        )}
        {balance && (
          <>
            <dt className="text-[var(--muted)]">Balance</dt>
            <dd className="figures">
              {balance.configured
                ? `${balance.remaining} of ${balance.entitled} days left this year. ${balance.pending} pending.`
                : "The yearly entitlement has not been set for this person yet, so no balance can be shown."}
            </dd>
          </>
        )}
        {r.decidedBy && (
          <>
            <dt className="text-[var(--muted)]">Decided by</dt>
            <dd>
              {r.decidedBy}
              {r.decisionNote ? `. ${r.decisionNote}` : ""}
            </dd>
          </>
        )}
        {r.status === "APPROVED" && (
          <>
            <dt className="text-[var(--muted)]">Return</dt>
            <dd>
              {r.actualReturnDate
                ? `${RETURN_WORD[r.returnStatus ?? "CONFIRMED"]}: ${showDate(r.actualReturnDate)}`
                : r.isOpenEnded
                  ? "No end date. Off the roster until their return is confirmed."
                  : `Expected back ${showDate(r.expectedReturnDate)}. ${r.returnStatus ? RETURN_WORD[r.returnStatus] : ""}`.trim()}
            </dd>
          </>
        )}
        {r.isOpenEnded && r.status === "SUBMITTED" && (
          <>
            <dt className="text-[var(--muted)]">End date</dt>
            <dd>None. Open-ended from {showDate(r.startDate)}.</dd>
          </>
        )}
        {r.extensionOfId && (
          <>
            <dt className="text-[var(--muted)]">Extension</dt>
            <dd>This continues earlier leave.</dd>
          </>
        )}
      </dl>

      {decider && impact && (
        <div className="mt-4 space-y-2" aria-label="Coverage impact">
          <h3 className="text-[15px] font-semibold">What approving does to cover</h3>
          <Notice tone={impact.needsReview ? "warning" : "neutral"}>
            {impact.summary.map((s, i) => (
              <span key={i} className="block">
                {s}
              </span>
            ))}
          </Notice>
        </div>
      )}
      {decider && history.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-[15px] font-semibold">Earlier approved leave</h3>
          <ul className="text-[15px]">
            {history.map((h) => (
              <li key={h.id}>
                {h.typeName}, {span(h)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warning && (
        <div className="mt-4">
          <Notice tone="warning">{warning}</Notice>
        </div>
      )}
      {problem && (
        <div className="mt-4">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}

      {decider && open && (
        <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
          {impact?.needsReview && <Checkbox label="I have reviewed the coverage impact" checked={reviewed} onChange={setReviewed} />}
          {calc && (
            <Field label="Duty resumes on" hint={working ?? "Worked out from the dates asked for."}>
              {(a) => <Input {...a} type="date" min={r.startDate} value={resume} onChange={(e) => setResume(e.target.value)} />}
            </Field>
          )}
          <Field label="Note to the person" optional hint="Needed when you reject." error={noteError ?? undefined}>
            {(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || (Boolean(impact?.needsReview) && !reviewed)} onClick={() => act("decide", { decision: "approve", note, reviewedImpact: reviewed, ...(calc && resume ? { expectedReturnDate: resume } : {}) })}>
              Approve
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => act("decide", { decision: "reject", note })}>
              Reject
            </Button>
          </div>
        </div>
      )}
      {(mine || decider) && <ReturnActions request={r} onDone={() => { onChanged(); reload(); }} />}
      {decider && r.status === "APPROVED" && r.actualReturnDate && <ReinstatePanel requestId={r.id} onDone={onChanged} />}
      {(mine || decider) && (r.status === "SUBMITTED" || (r.status === "APPROVED" && decider)) && (
        <div className="mt-3">
          <Button variant="quiet" disabled={busy} onClick={() => act("cancel")}>
            Cancel this request
          </Button>
        </div>
      )}
    </Panel>
  );
}

export default function LeavePage() {
  const facility = useFacility();
  const decider = ["FACILITY_ADMIN", "ROSTER_MANAGER", "SUPERVISOR"].includes(facility.me.role);
  const [status, setStatus] = useState(decider ? "open" : "");
  const [selected, setSelected] = useState<string | null>(null);
  const who = useResource<{ myStaffId: string | null }>("/api/facility/leave/types");
  const { data, error, reload } = useResource<{ requests: LeaveRequestRow[] }>(`/api/facility/leave/requests${status ? `?status=${status}` : ""}`);

  return (
    <>
      <PageHeader
        title={decider ? "Leave requests" : "My leave"}
        description={decider ? "Decide requests, and see what each one does to cover before you approve." : "Your requests, and whether they have been approved."}
        actions={<ButtonLink href="/leave/request">Request leave</ButtonLink>}
      />
      <div className="mb-4 max-w-xs">
        <label htmlFor="leave-filter" className="mb-1 block text-sm font-medium">
          Show
        </label>
        <Select id="leave-filter" value={status} onChange={(e) => { setStatus(e.target.value); setSelected(null); }}>
          {decider && <option value="open">Awaiting decision</option>}
          <option value="">All</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>

      {selected && (
        <div className="mb-6">
          <Detail key={selected} id={selected} decider={decider} myStaffId={who.data?.myStaffId ?? null} onChanged={reload} onClose={() => setSelected(null)} />
        </div>
      )}

      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading requests" />
      ) : data.requests.length === 0 ? (
        <EmptyState title={status === "open" ? "Nothing waiting for a decision" : "No leave requests"}>
          {decider ? "Requests appear here when staff ask for leave." : "Use Request leave to ask for time off."}
        </EmptyState>
      ) : (
        <TableScroll label="Leave requests, scrolls sideways on small screens">
          <table className="w-full min-w-[40rem] border-collapse text-left text-[15px]">
            <caption className="sr-only">Leave requests</caption>
            <thead>
              <tr className="text-sm text-[var(--muted)]">
                {["Person", "Type", "Dates", "Days", "Status", ""].map((h, i) => (
                  <th key={i} scope="col" className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="border-b border-[var(--border)] px-3 py-2 font-medium">
                    {r.staffName}
                  </th>
                  <td className="border-b border-[var(--border)] px-3 py-2">{r.typeName}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2">{span(r)}</td>
                  <td className="figures border-b border-[var(--border)] px-3 py-2">{r.days}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2">
                    <StatusBadge tone={STATUS[r.status].tone}>{STATUS[r.status].word}</StatusBadge>
                  </td>
                  <td className="border-b border-[var(--border)] px-3 py-1 text-right">
                    <Button variant="secondary" aria-label={`Open ${r.staffName}, ${r.typeName.toLowerCase()} leave, ${span(r)}`} onClick={() => setSelected(r.id)}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
