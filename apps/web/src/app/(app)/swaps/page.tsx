"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import type { SwapRow } from "@/lib/types";
import { Button, Checkbox, EmptyState, Field, Loading, LoadError, Notice, PageHeader, Panel, StatusBadge, Textarea } from "@/components/ui";

const WORDS: Record<SwapRow["status"], { word: string; tone: "neutral" | "success" | "warning" | "block" }> = {
  REQUESTED: { word: "Waiting for the other person", tone: "warning" },
  ACCEPTED: { word: "Waiting for approval", tone: "warning" },
  DECLINED: { word: "Declined", tone: "neutral" },
  APPROVED: { word: "Approved", tone: "success" },
  REJECTED: { word: "Not approved", tone: "block" },
  CANCELLED: { word: "Cancelled", tone: "neutral" },
  EXPIRED: { word: "Expired", tone: "neutral" },
};

const line = (s: SwapRow) =>
  s.type === "EXCHANGE" && s.gives && s.takes
    ? `${s.requester} gives ${s.gives.shift} on ${showDate(s.gives.date)} and takes ${s.takes.shift} on ${showDate(s.takes.date)} from ${s.target}.`
    : s.gives
      ? `${s.requester} hands ${s.gives.shift} on ${showDate(s.gives.date)} to ${s.target}.`
      : "";

interface Detail {
  swap: SwapRow;
  check: { ok: boolean; hard: string[]; warnings: string[] } | null;
}

function Open({ id, me, decider, onChanged, onClose }: { id: string; me: string | null; decider: boolean; onChanged: () => void; onClose: () => void }) {
  const { data, error, reload } = useResource<Detail>(`/api/facility/swaps/${id}`);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; reasons?: string[]; needsConfirm?: boolean } | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Checking this swap against the roster as it is now" />;
  const { swap: s, check } = data;

  async function act(path: string, body?: object) {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/api/facility/swaps/${id}/${path}`, body);
      onChanged();
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string; reasons?: string[]; error?: string; fields?: Record<string, string> }) : undefined;
      setProblem({ text: b?.fields?.note ?? b?.message ?? "That did not work. Check your connection and try again.", reasons: b?.reasons, needsConfirm: b?.error === "confirm_warnings" });
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={s.type === "EXCHANGE" ? "Duty exchange" : "Duty handover"} description={s.month} actions={<span className="flex items-center gap-2"><StatusBadge tone={WORDS[s.status].tone}>{WORDS[s.status].word}</StatusBadge><Button variant="quiet" onClick={onClose}>Close</Button></span>}>
      <p className="text-[15px]">{line(s)}</p>
      {s.reason && <p className="mt-1 text-[15px] text-[var(--muted)]">Reason: {s.reason}</p>}
      {s.responseNote && <p className="mt-1 text-[15px] text-[var(--muted)]">Their answer: {s.responseNote}</p>}
      {s.decisionNote && <p className="mt-1 text-[15px] text-[var(--muted)]">{s.decidedBy ? "Decision" : "Note"}: {s.decisionNote}</p>}

      {check && (
        <div className="mt-4 space-y-2">
          <h3 className="text-[15px] font-semibold">Checked just now against the roster as it is today</h3>
          {check.ok && check.warnings.length === 0 && <Notice tone="success">No rule is broken by this swap.</Notice>}
          {!check.ok && (
            <Notice tone="block">
              <span className="block font-medium">This swap can no longer go ahead.</span>
              {check.hard.map((h, i) => (<span key={i} className="block">{h}</span>))}
            </Notice>
          )}
          {check.ok && check.warnings.length > 0 && (
            <Notice tone="warning">
              <span className="block font-medium">The swap is lawful but causes warnings.</span>
              {check.warnings.map((h, i) => (<span key={i} className="block">{h}</span>))}
            </Notice>
          )}
        </div>
      )}
      {problem && (
        <div className="mt-3">
          <Notice tone="block">
            {problem.text}
            {problem.reasons?.slice(1).map((r, i) => (<span key={i} className="block">{r}</span>))}
          </Notice>
        </div>
      )}

      {s.status === "REQUESTED" && s.targetId === me && (
        <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
          <Field label="Note" optional>{(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => act("respond", { accept: true, note })}>Accept</Button>
            <Button variant="secondary" disabled={busy} onClick={() => act("respond", { accept: false, note })}>Decline</Button>
          </div>
        </div>
      )}
      {decider && s.status === "ACCEPTED" && (
        <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
          {check?.ok && check.warnings.length > 0 && <Checkbox label="I have read the warnings and approve anyway" checked={confirm} onChange={setConfirm} />}
          <Field label="Note" optional hint="Needed when you do not approve.">{(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button disabled={busy || !check?.ok || (check.warnings.length > 0 && !confirm)} onClick={() => act("decide", { decision: "approve", note, confirmWarnings: confirm })}>Approve</Button>
            <Button variant="secondary" disabled={busy} onClick={() => act("decide", { decision: "reject", note })}>Do not approve</Button>
          </div>
        </div>
      )}
      {["REQUESTED", "ACCEPTED"].includes(s.status) && (s.requesterId === me || decider) && (
        <div className="mt-3"><Button variant="quiet" disabled={busy} onClick={() => act("cancel")}>Cancel this swap</Button></div>
      )}
    </Panel>
  );
}

const TABS = [
  { key: "respond", label: "Waiting for my answer" },
  { key: "approve", label: "Waiting for approval" },
  { key: "mine", label: "My requests" },
  { key: "history", label: "History" },
] as const;

export default function SwapsPage() {
  const { data, error, reload } = useResource<{ myStaffId: string | null; decider: boolean; swaps: SwapRow[] }>("/api/facility/swaps");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("respond");
  const [selected, setSelected] = useState<string | null>(null);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading swaps" />;
  const me = data.myStaffId;
  const open = (s: SwapRow) => ["REQUESTED", "ACCEPTED"].includes(s.status);
  const tabs = TABS.filter((t) => t.key !== "approve" || data.decider);
  const rows = data.swaps.filter((s) => {
    if (tab === "respond") return s.status === "REQUESTED" && s.targetId === me;
    if (tab === "approve") return s.status === "ACCEPTED";
    if (tab === "mine") return open(s) && s.requesterId === me;
    return !open(s);
  });

  return (
    <>
      <PageHeader title="Duty swaps" description="Hand a duty over, or trade for another. Every swap is checked against the rules again when it is approved." />
      <div role="tablist" aria-label="Swaps" className="mb-4 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {tabs.map((t) => {
          const count = data.swaps.filter((s) => (t.key === "respond" ? s.status === "REQUESTED" && s.targetId === me : t.key === "approve" ? s.status === "ACCEPTED" : false)).length;
          return (
            <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setSelected(null); }}
              className={`min-h-11 px-3 text-[15px] ${tab === t.key ? "border-b-2 border-[var(--accent)] font-medium" : "text-[var(--muted)]"}`}>
              {t.label}{count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>
      {selected && <div className="mb-6"><Open key={selected} id={selected} me={me} decider={data.decider} onChanged={reload} onClose={() => setSelected(null)} /></div>}
      {rows.length === 0 ? (
        <EmptyState title="Nothing here">{tab === "mine" ? "Ask for a swap from My duties." : "No swaps in this list."}</EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="text-[15px]">{line(s)}</p>
                <StatusBadge tone={WORDS[s.status].tone}>{WORDS[s.status].word}</StatusBadge>
              </div>
              <Button variant="secondary" aria-label={`Open swap: ${line(s)}`} onClick={() => setSelected(s.id)}>Open</Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
