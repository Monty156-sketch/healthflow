"use client";

import { WardDemand } from "@/components/WardDemand";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { MONTHS, showDate } from "@/lib/format";
import type { RosterFinding, RosterView, Shortfall } from "@/lib/types";
import { Button, Field, Loading, LoadError, Notice, PageHeader, Panel, StatusBadge, Textarea } from "@/components/ui";
import { GridChip, MonthGrid } from "@/components/MonthGrid";
import { CellEditor } from "@/components/CellEditor";
import { VersionsPanel } from "@/components/VersionsPanel";
import { STATUS_WORD, statusTone } from "@/lib/rosterStatus";

interface Cell {
  code: string;
  colour: string | null;
  name: string;
  off: boolean;
  afterRun: boolean;
}

const SHOWN = 40;

function FindingList({
  title,
  items,
  nameOf,
  onOverride,
}: {
  title: string;
  items: RosterFinding[];
  nameOf: (id: string | null) => string;
  onOverride?: (id: string, reason: string) => Promise<string | null>;
}) {
  const [all, setAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, SHOWN);
  const block = items[0].severity === "BLOCK";
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-[15px] font-semibold">
        {title} <span className="figures font-normal text-[var(--muted)]">({items.length})</span>
      </h3>
      <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
        {shown.map((f) => (
          <li key={f.id} className="flex gap-3 px-4 py-3 text-[15px]">
            <span className="shrink-0 pt-0.5">
              <StatusBadge tone={block ? "block" : "warning"}>{block ? "Blocking" : "Warning"}</StatusBadge>
            </span>
            <span className="min-w-0">
              <span className="block">{f.message}</span>
              <span className="figures block text-sm text-[var(--muted)]">
                Rule {f.ruleCode}
                {f.staffId ? `, ${nameOf(f.staffId)}` : ""}
                {f.date ? `, ${showDate(f.date)}` : ""}
              </span>
              {onOverride && openId !== f.id && (
                <span className="mt-1 block">
                  <Button variant="quiet" onClick={() => { setOpenId(f.id); setReason(""); setProblem(null); }}>
                    Accept with a reason
                  </Button>
                </span>
              )}
              {onOverride && openId === f.id && (
                <span className="mt-2 block max-w-xl space-y-2">
                  <Field label="Why can this stand" hint="Kept on the roster and in the audit log." error={problem ?? undefined}>
                    {(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}
                  </Field>
                  <span className="flex gap-2">
                    <Button
                      disabled={busy || reason.trim().length === 0}
                      onClick={async () => {
                        setBusy(true);
                        const err = await onOverride(f.id, reason);
                        setBusy(false);
                        if (err) setProblem(err);
                        else setOpenId(null);
                      }}
                    >
                      {busy ? "Saving…" : "Accept finding"}
                    </Button>
                    <Button variant="secondary" onClick={() => setOpenId(null)}>
                      Cancel
                    </Button>
                  </span>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {items.length > SHOWN && !all && (
        <div className="mt-2">
          <Button variant="quiet" onClick={() => setAll(true)}>
            Show all {items.length}
          </Button>
        </div>
      )}
    </section>
  );
}

interface Applied {
  cycles: { name: string; rule: string; enforcement: string }[];
  rotations: { name: string; enforcement: string }[];
  ledgerPeople: number;
  carriedPeople: number;
  lockedKept: number;
  variation: number;
}

export default function RosterPage() {
  const { id } = useParams<{ id: string }>();
  const facility = useFacility();
  const canRoster = ["FACILITY_ADMIN", "ROSTER_MANAGER"].includes(facility.me.role);
  const { data, error, reload } = useResource<RosterView>(`/api/facility/rosters/${id}`);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [xlsBusy, setXlsBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shortfalls, setShortfalls] = useState<{ list: Shortfall[]; more: number } | null>(null);
  const [editing, setEditing] = useState<{ staffId: string; date: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [flow, setFlow] = useState<string | null>(null);
  type Change = { staffId: string; date: string; from: string | null; to: string };
  const [undo, setUndo] = useState<Change[]>([]);
  const [redo, setRedo] = useState<Change[]>([]);
  const [versionKey, setVersionKey] = useState(0);

  const shiftById = useMemo(() => new Map((data?.shifts ?? []).map((s) => [s.id, s])), [data]);
  const cells = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const a of data?.assignments ?? []) {
      const s = shiftById.get(a.shiftId);
      if (!s) continue;
      m.set(`${a.staffId}|${a.date}`, { code: s.code, colour: s.colour, name: s.name, off: !s.countsAsDuty, afterRun: a.source === "REST_BLOCK" });
    }
    return m;
  }, [data, shiftById]);
  const stripes = useMemo(() => {
    const m = new Map<string, "BLOCK" | "WARN">();
    for (const f of data?.findings ?? []) {
      if (!f.staffId || !f.date || f.status !== "OPEN") continue;
      const k = `${f.staffId}|${f.date}`;
      if (f.severity === "BLOCK" || !m.has(k)) m.set(k, f.severity === "BLOCK" ? "BLOCK" : "WARN");
    }
    return m;
  }, [data]);
  const names = useMemo(() => new Map((data?.staff ?? []).map((s) => [s.id, s.name])), [data]);

  const [applied, setApplied] = useState<Applied | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading roster" />;

  const { roster, summary } = data;
  const generated = roster.status !== "DRAFT";
  const isAdmin = facility.me.role === "FACILITY_ADMIN";
  const canGenerate = roster.status === "DRAFT" || roster.status === "GENERATED";
  const canEdit = canRoster && (roster.status === "GENERATED" || roster.status === "UNDER_REVIEW");
  const editable = canGenerate;

  async function move(action: string) {
    setBusy(true);
    setFlow(null);
    setPending(null);
    try {
      await api.post(`/api/facility/rosters/${id}/status`, { action });
      reload();
    } catch (err) {
      setFlow(err instanceof ApiError ? ((err.body as { message?: string })?.message ?? "That did not work.") : "That did not work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function replay(list: Change[], setList: (c: Change[]) => void, other: Change[], setOther: (c: Change[]) => void, direction: "undo" | "redo") {
    const c = list[list.length - 1];
    const target = direction === "undo" ? c.from : c.to;
    if (!target) return;
    setBusy(true);
    setFlow(null);
    try {
      await api.put(`/api/facility/rosters/${id}/cell`, { staffId: c.staffId, date: c.date, shiftId: target });
      setList(list.slice(0, -1));
      setOther([...other, c]);
      reload();
    } catch (err) {
      setFlow(err instanceof ApiError ? ((err.body as { message?: string })?.message ?? "That did not work.") : "That did not work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function override(findingId: string, reason: string): Promise<string | null> {
    try {
      await api.post(`/api/facility/rosters/${id}/findings/${findingId}/override`, { reason });
      reload();
      return null;
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string; fields?: Record<string, string> }) : undefined;
      return body?.fields?.reason ?? body?.message ?? "That did not save. Try again.";
    }
  }

  const ACTIONS: Record<string, { label: string; confirm?: string; admin?: boolean; quiet?: boolean }[]> = {
    GENERATED: [{ label: "Send for review", confirm: "submit" }],
    UNDER_REVIEW: [
      { label: "Approve", confirm: "approve", admin: true },
      { label: "Return for changes", confirm: "return", admin: true, quiet: true },
    ],
    APPROVED: [
      { label: "Publish", confirm: "publish", admin: true },
      { label: "Reopen for changes", confirm: "reopen", admin: true, quiet: true },
    ],
    PUBLISHED: [{ label: "Archive", confirm: "archive", admin: true, quiet: true }],
  };
  const SAYS: Record<string, string> = {
    submit: "Sending it for review hands it to a facility admin to approve. You can still change duties while it is in review.",
    approve: "Approving saves a version and stops further changes. A facility admin can reopen it.",
    return: "This sends the roster back so duties can be changed again.",
    publish: "Publishing makes this the roster staff follow and saves a version.",
    reopen: "Reopening lets duties be changed again. Approve it again afterwards.",
    archive: "Archiving closes the month. It stays readable.",
  };
  const available = (ACTIONS[roster.status] ?? []).filter((a) => canRoster && (!a.admin || isAdmin));

  async function downloadPdf() {
    setPdfBusy(true);
    try {
      await api.download(`/api/facility/rosters/${id}/pdf`, "roster.pdf");
    } catch {
      setFlow("The PDF could not be made. Check your connection and try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadExcel() {
    setXlsBusy(true);
    try {
      await api.download(`/api/facility/rosters/${id}/excel`, "roster.xlsx");
    } catch {
      setFlow("The Excel file could not be made. Check your connection and try again.");
    } finally {
      setXlsBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setProblem(null);
    setShortfalls(null);
    setConfirming(false);
    try {
      const r = await api.post<{ applied: Applied }>(`/api/facility/rosters/${id}/generate`, {});
      setApplied(r.applied);
      reload();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string; shortfalls?: Shortfall[]; more?: number }) : undefined;
      if (body?.shortfalls) setShortfalls({ list: body.shortfalls, more: body.more ?? 0 });
      setProblem(body?.message ?? "The roster could not be generated. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const blocking = data.findings.filter((f) => f.severity === "BLOCK" && f.status === "OPEN");
  const warnings = data.findings.filter((f) => f.severity === "WARN" && f.status === "OPEN");
  const accepted = data.findings.filter((f) => f.status === "OVERRIDDEN");
  const nameOf = (sid: string | null) => (sid ? names.get(sid) ?? "" : "");
  const legend = data.shifts.filter((s) => s.active || data.assignments.some((a) => a.shiftId === s.id));

  return (
    <>
      <p className="no-print mb-2 text-sm">
        <Link href="/roster" className="text-[var(--accent)] underline-offset-2 hover:underline">
          All rosters
        </Link>
      </p>
      <PageHeader
        title={`${MONTHS[roster.month - 1]} ${roster.year} roster${roster.department ? `, ${roster.department}` : ""}`}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusBadge tone={statusTone(roster.status)}>{STATUS_WORD[roster.status]}</StatusBadge>
            {roster.generatedAt && <span>Generated {showDate(roster.generatedAt)}</span>}
          </span>
        }
        actions={
          <span className="no-print flex flex-wrap gap-2">
            <Button variant="secondary" disabled={pdfBusy} onClick={downloadPdf}>
              {pdfBusy ? "Preparing PDF…" : "Download PDF"}
            </Button>
            <Button variant="secondary" disabled={xlsBusy} onClick={downloadExcel}>
              {xlsBusy ? "Preparing Excel…" : "Download Excel"}
            </Button>
            {generated && (
              <Button variant="quiet" onClick={() => window.print()}>
                Print this page
              </Button>
            )}
            {canRoster && canGenerate && !confirming && (
              <Button onClick={() => (generated ? setConfirming(true) : generate())} disabled={busy}>
                {busy ? "Generating…" : generated ? "Generate again" : "Generate roster"}
              </Button>
            )}
          </span>
        }
      />
      <p className="mb-3 hidden text-sm print:block">
        {facility.facility.name}. {STATUS_WORD[roster.status]}, version {roster.version}.
      </p>

      {confirming && (
        <div className="mb-4">
          <Notice
            tone="warning"
            action={
              <span className="flex gap-2">
                <Button onClick={generate}>Replace the roster</Button>
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </span>
            }
          >
            Generating again replaces every duty that is not locked with a new roster, built from your current duty cycles, rotation order, duty ledger and the last three months. Each time gives a different lawful roster.
          </Notice>
        </div>
      )}
      {roster.departmentId && canRoster && canGenerate && (
        <div className="no-print mb-4">
          <WardDemand departmentId={roster.departmentId} editable />
        </div>
      )}
      {applied && !problem && (
        <div className="mb-4">
          <Notice tone="success">
            Built again with {applied.cycles.length === 0 ? "no duty cycle rules" : `${applied.cycles.length} duty ${applied.cycles.length === 1 ? "cycle" : "cycles"} (${applied.cycles.map((c) => `${c.name}, ${c.rule}`).join("; ")})`}
            {applied.rotations.length > 0 && `, rotation ${applied.rotations.map((r) => r.name).join(", ")}`}
            {applied.ledgerPeople > 0 && `, the duty ledger for ${applied.ledgerPeople} ${applied.ledgerPeople === 1 ? "person" : "people"}`}
            {applied.carriedPeople > 0 && `, and duties carried over from the last three months for ${applied.carriedPeople} ${applied.carriedPeople === 1 ? "person" : "people"}`}.
            {applied.variation > 0 ? ` This is variation ${applied.variation}; generate again for another.` : ""}
          </Notice>
        </div>
      )}
      {problem && (
        <div className="mb-4 space-y-3">
          <Notice tone="block">{problem}</Notice>
          {shortfalls && (
            <Panel title="What is missing" description="The roster needs at least this many people on these days, and your staff list cannot supply them.">
              <ul className="list-disc space-y-1 pl-5 text-[15px]">
                {shortfalls.list.map((s, i) => (
                  <li key={i}>{s.sentence}</li>
                ))}
              </ul>
              {shortfalls.more > 0 && <p className="mt-2 text-sm text-[var(--muted)]">And {shortfalls.more} more like these.</p>}
            </Panel>
          )}
        </div>
      )}

      {!generated ? (
        <Notice>
          Nothing has been planned for this month yet. {canRoster ? "Generate the roster to fill it from your shifts, duty cycles and staff, then check it against the rules." : "A roster manager can generate it."}
        </Notice>
      ) : (
        <>
          <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[15px]" aria-label="Roster totals">
            {[
              ["Duties", summary.duties],
              ["Unfilled", summary.unfilled],
              ["Blocking findings", summary.blocks],
              ["Warnings", summary.warnings],
            ].map(([label, n]) => (
              <div key={label} className="flex gap-1.5">
                <dt className="text-[var(--muted)]">{label}</dt>
                <dd className="figures font-semibold">{n}</dd>
              </div>
            ))}
          </dl>

          {available.length > 0 && (
            <div className="no-print mb-4">
              {pending ? (
                <Notice
                  tone="warning"
                  action={
                    <span className="flex gap-2">
                      <Button onClick={() => move(pending)} disabled={busy}>
                        {busy ? "Working…" : "Yes, continue"}
                      </Button>
                      <Button variant="secondary" onClick={() => setPending(null)}>
                        Not now
                      </Button>
                    </span>
                  }
                >
                  {SAYS[pending]}
                </Notice>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {available.map((a) => (
                    <Button key={a.label} variant={a.quiet ? "secondary" : "primary"} onClick={() => setPending(a.confirm!)} disabled={busy}>
                      {a.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!available.length && roster.status === "UNDER_REVIEW" && (
            <div className="mb-4">
              <Notice>This roster is waiting for a facility admin to approve it.</Notice>
            </div>
          )}
          {flow && (
            <div className="no-print mb-4">
              <Notice tone="block">{flow}</Notice>
            </div>
          )}
          {editing && (
            <CellEditor
              key={`${editing.staffId}|${editing.date}`}
              rosterId={roster.id}
              staffId={editing.staffId}
              staffName={nameOf(editing.staffId)}
              date={editing.date}
              currentShiftId={data.assignments.find((a) => a.staffId === editing.staffId && a.date === editing.date)?.shiftId ?? null}
              shifts={data.shifts.filter((x) => x.active || !x.countsAsDuty)}
              onDone={(saved, change) => {
                setEditing(null);
                if (saved) {
                  if (change) {
                    setUndo((u) => [...u, change]);
                    setRedo([]);
                  }
                  reload();
                }
              }}
            />
          )}
          {canEdit && (undo.length > 0 || redo.length > 0) && (
            <div className="no-print mb-2 flex flex-wrap gap-2" role="group" aria-label="Undo and redo">
              <Button variant="secondary" disabled={busy || !undo.length || !undo[undo.length - 1].from} onClick={() => replay(undo, setUndo, redo, setRedo, "undo")}>
                Undo last change
              </Button>
              <Button variant="secondary" disabled={busy || !redo.length} onClick={() => replay(redo, setRedo, undo, setUndo, "redo")}>
                Redo
              </Button>
            </div>
          )}
          <MonthGrid<Cell>
            year={roster.year}
            month={roster.month}
            staff={data.staff}
            caption={`${MONTHS[roster.month - 1]} ${roster.year} roster`}
            cellData={(staffId, iso) => cells.get(`${staffId}|${iso}`)}
            renderCell={(c) =>
              c.afterRun ? (
                <span className="inline-flex rounded-[5px] outline-1 outline-offset-1 outline-dashed outline-[var(--muted)]">
                  <GridChip code={c.code} tone="off" colour={c.colour ?? undefined} />
                </span>
              ) : (
                <GridChip code={c.code} tone={c.off ? "off" : "neutral"} colour={c.colour ?? undefined} />
              )
            }
            onCellClick={canEdit ? (staffId, date) => setEditing({ staffId, date }) : undefined}
            describeCell={(c) => (c.afterRun ? `${c.name}, rest after a run of duties` : c.name)}
            stripe={(staffId, iso) => {
              const s = stripes.get(`${staffId}|${iso}`);
              return s === "BLOCK" ? "var(--status-block)" : s === "WARN" ? "var(--status-warning)" : null;
            }}
          />

          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {legend.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5">
                <dt>
                  <GridChip code={s.code} tone={s.countsAsDuty ? "neutral" : "off"} colour={s.colour ?? undefined} />
                </dt>
                <dd>{s.name}</dd>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <dt>
                <span className="inline-flex rounded-[5px] outline-1 outline-offset-1 outline-dashed outline-[var(--muted)]">
                  <GridChip code="D/O" tone="off" />
                </span>
              </dt>
              <dd>Off days after a run of duties</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>
                <span aria-hidden="true" className="inline-block h-4 w-[3px] bg-[var(--status-block)]" />
              </dt>
              <dd>Blocking finding</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>
                <span aria-hidden="true" className="inline-block h-4 w-[3px] bg-[var(--status-warning)]" />
              </dt>
              <dd>Warning</dd>
            </div>
          </dl>

          <div className="no-print mt-6 space-y-5">
            <h2 className="text-lg font-semibold">Checked against the rules</h2>
            {!blocking.length && !warnings.length ? (
              <Notice tone="success">No findings. Every rule that is switched on is met.</Notice>
            ) : (
              <>
                <FindingList title="Blocking" items={blocking} nameOf={nameOf} onOverride={isAdmin && (roster.status === "GENERATED" || roster.status === "UNDER_REVIEW") ? override : undefined} />
                <FindingList title="Warnings" items={warnings} nameOf={nameOf} />
              </>
            )}
            <div className="no-print">
              <VersionsPanel rosterId={roster.id} canRestore={canEdit} refreshKey={roster.version} onRestored={() => { setUndo([]); setRedo([]); reload(); }} />
            </div>
            {accepted.length > 0 && (
              <section aria-label="Accepted with a reason">
                <h3 className="mb-2 text-[15px] font-semibold">
                  Accepted with a reason <span className="figures font-normal text-[var(--muted)]">({accepted.length})</span>
                </h3>
                <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
                  {accepted.map((f) => (
                    <li key={f.id} className="px-4 py-3 text-[15px]">
                      <span className="block">{f.message}</span>
                      <span className="block text-sm text-[var(--muted)]">
                        Rule {f.ruleCode}. Reason: {f.overrideReason}
                        {f.overrideBy ? ` (${f.overrideBy})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}
