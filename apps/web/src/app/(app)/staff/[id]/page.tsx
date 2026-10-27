"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ReactNode, Suspense, useCallback, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { StaffForm } from "@/components/StaffForm";
import { NoNightsPanel } from "@/components/NoNightsPanel";
import { ConsentPanel, InvitePanel, type PendingInvitation } from "@/components/StaffAccess";
import { api, ApiError } from "@/lib/api";
import { useResource, useSave } from "@/lib/useApi";
import { EMPLOYMENT, LEAVING_STATUSES, ROLE, STAFF_STATUS, showDate, showDateTime } from "@/lib/format";
import type { Staff } from "@/lib/types";
import { Button, ConfirmDialog, Field, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, Input } from "@/components/ui";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm text-[var(--muted)]">{label}</dt>
      <dd>{children ?? <span className="text-[var(--muted)]">Not recorded</span>}</dd>
    </div>
  );
}

function Details({ s }: { s: Staff }) {
  return (
    <dl className="divide-y divide-[var(--border)]">
      <Row label="Staff number">
        <span className="figures">{s.staffNo}</span>
      </Row>
      <Row label="Position">{s.position}</Row>
      <Row label="Cadre">{s.cadre?.name}</Row>
      <Row label="Department">{s.department?.name}</Row>
      <Row label="Employment type">{EMPLOYMENT[s.employmentStatus]}</Row>
      <Row label="Date joined">{s.dateJoined ? <span className="figures">{showDate(s.dateJoined)}</span> : null}</Row>
      <Row label="Phone">{s.phone}</Row>
      <Row label="Email">{s.email}</Row>
      <Row label="Emergency contact">
        {s.emergencyContactName || s.emergencyContactPhone
          ? [s.emergencyContactName, s.emergencyContactPhone].filter(Boolean).join(", ")
          : null}
      </Row>
      <Row label="Night duty">
        {s.excludedFromNights ? `Excluded. Reason: ${s.exclusionReason}` : "Can be rostered for nights"}
      </Row>
      <Row label="Shifts they may work">
        {s.eligibleShifts && s.eligibleShifts.length > 0 ? s.eligibleShifts.map((x) => x.name).join(", ") : "Every shift their cadre allows"}
      </Row>
      <Row label="Maximum duties per week">
        <span className="figures">{s.maxDutiesPerWeek === 0 ? "No limit" : s.maxDutiesPerWeek}</span>
      </Row>
    </dl>
  );
}

interface Destination { id: string; name: string; region: string | null; district: string | null }

/** Posting to another facility on HealthFlow, or deleting the person. */
function MovePanel({ s }: { s: Staff }) {
  const { reload } = useFacility();
  const router = useRouter();
  const [mode, setMode] = useState<"move" | "delete" | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Destination[] | null>(null);
  const [dest, setDest] = useState<Destination | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const firstName = s.fullName.split(" ")[0];
  const current = ["ACTIVE", "ON_LEAVE"].includes(s.status);

  async function search(text: string) {
    setQ(text);
    setDest(null);
    if (text.trim().length < 3) return setFound(null);
    try {
      setFound((await api.get<{ facilities: Destination[] }>(`/api/facility/staff-moves/destinations?q=${encodeURIComponent(text.trim())}`)).facilities);
    } catch {
      setFound([]);
    }
  }
  const fail = (e: unknown) => setProblem(e instanceof ApiError ? ((e.body as { message?: string; fields?: Record<string, string> } | undefined)?.message ?? Object.values((e.body as { fields?: Record<string, string> } | undefined)?.fields ?? {})[0] ?? "That did not go through.") : "That did not go through. Check your connection and try again.");
  async function ask() {
    if (!dest) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post("/api/facility/staff-moves", { staffId: s.id, toFacilityId: dest.id, note: note || undefined });
      setSent(dest.name);
      setMode(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setProblem(null);
    try {
      await api.delete(`/api/facility/staff/${s.id}`, { reason });
      reload();
      router.push("/staff");
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  }

  return (
    <Panel title="Transfer or delete">
      {sent && <Notice tone="success">Asked {sent} to take {firstName}. They move over when its administrator accepts. Follow it under Transfers.</Notice>}
      <div className="mt-2 flex flex-wrap gap-2">
        {current && <Button variant="secondary" onClick={() => { setMode("move"); setProblem(null); }}>Transfer to another facility</Button>}
        <Button variant="secondary" onClick={() => { setMode("delete"); setProblem(null); }}>Delete</Button>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">If the new facility is on HealthFlow, transfer {firstName} there and their details move across. Delete is for someone who left or was added by mistake.</p>
      <ConfirmDialog
        open={mode === "move"}
        title={`Transfer ${firstName} to another facility`}
        confirmLabel="Ask to transfer"
        busy={busy}
        onConfirm={() => { if (dest) void ask(); else setProblem("Search for the facility and choose it from the list."); }}
        onCancel={() => setMode(null)}
      >
        <p>The other facility&apos;s administrator must accept. Then {firstName}&apos;s details and sign in move there, so they do not register again. Here they are marked Transferred and their phone, email and photo are removed. Past rosters stay.</p>
        <div className="mt-3 space-y-3">
          <Field label="Search for the facility" hint="Type at least three letters of its name.">{(a) => <Input {...a} value={q} onChange={(e) => void search(e.target.value)} />}</Field>
          {found && found.length === 0 && <p className="text-sm text-[var(--muted)]">No facility on HealthFlow has that name. If it is not on HealthFlow yet, delete {firstName} here and add them there.</p>}
          {found && found.length > 0 && (
            <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)]">
              {found.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => setDest(f)} aria-pressed={dest?.id === f.id} className={`min-h-11 w-full px-3 py-2 text-left text-sm ${dest?.id === f.id ? "bg-[var(--surface-2)] font-medium" : ""}`}>
                    {f.name}<span className="block text-[var(--muted)]">{[f.district, f.region].filter(Boolean).join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label="Note for them" optional>{(a) => <Input {...a} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
        {problem && <div className="mt-3"><Notice tone="block">{problem}</Notice></div>}
      </ConfirmDialog>
      <ConfirmDialog
        open={mode === "delete"}
        title={`Delete ${s.fullName}?`}
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setMode(null)}
      >
        <p>{s.account ? `${firstName}'s sign in is removed and they are signed out. ` : ""}Their phone, email, photo and emergency contact are removed. Their name and staff number stay on past rosters and in the audit log, because those records must stay true.</p>
        <div className="mt-3"><Field label="Reason" hint="Kept in the audit log.">{(a) => <Input {...a} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}</Field></div>
        {problem && <div className="mt-3"><Notice tone="block">{problem}</Notice></div>}
      </ConfirmDialog>
    </Panel>
  );
}

function StatusPanel({ s, onChanged }: { s: Staff; onChanged: (s: Staff) => void }) {
  const { isAdmin, reload } = useFacility();
  const [next, setNext] = useState(s.status);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const change = useCallback(
    async (status: string) => (await api.patch<{ staff: Staff }>(`/api/facility/staff/${s.id}/status`, { status, reason })).staff,
    [s.id, reason]
  );
  const save = useSave(change);
  const current = STAFF_STATUS[s.status];
  const leaving = LEAVING_STATUSES.includes(next);
  const firstName = s.fullName.split(" ")[0];

  async function confirm() {
    const updated = await save.run(next);
    if (updated) {
      setConfirming(false);
      setReason("");
      onChanged(updated);
      reload();
    }
  }

  return (
    <Panel title="Status">
      <StatusBadge tone={current.tone}>{current.label}</StatusBadge>
      {LEAVING_STATUSES.includes(s.status) && (
        <p className="mt-2 text-sm text-[var(--muted)]">Kept for the record. Not rostered and cannot sign in.</p>
      )}
      {isAdmin && (
        <div className="mt-4 space-y-3">
          <Field label="Change status to">
            {(a) => (
              <Select {...a} value={next} onChange={(e) => setNext(e.target.value)}>
                {Object.entries(STAFF_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button variant="secondary" disabled={next === s.status} onClick={() => setConfirming(true)}>
            Change status
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Change ${firstName}'s status to ${STAFF_STATUS[next]?.label}?`}
        confirmLabel="Change status"
        tone={leaving ? "danger" : "primary"}
        busy={save.state === "saving"}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      >
        {leaving ? (
          <p>
            {s.account
              ? `${firstName} will lose access to HealthFlow and be signed out on every device straight away. `
              : ""}
            They will no longer be rostered. Their record and history are kept.
          </p>
        ) : (
          <p>
            {s.account && LEAVING_STATUSES.includes(s.status)
              ? `${firstName} will be able to sign in again.`
              : "Their record will be updated."}
          </p>
        )}
        <div className="mt-3">
          <Field label="Reason" hint="Kept in the audit log.">{(a) => <Input {...a} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}</Field>
        </div>
        {save.state === "failed" && save.message && (
          <div className="mt-3">
            <Notice tone="block">{save.message}</Notice>
          </div>
        )}
      </ConfirmDialog>
    </Panel>
  );
}

/** A one-use reset link for a staff member who cannot receive email. */
function ResetLink({ s }: { s: Staff }) {
  const { isAdmin } = useFacility();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!isAdmin || !s.account?.active) return null;

  async function create() {
    setProblem(null);
    setBusy(true);
    try {
      setLink(await api.post<{ url: string; expiresAt: string }>(`/api/facility/staff/${s.id}/reset-link`));
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
      setProblem(body?.message ?? "The link could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-4 border-t border-[var(--border)] pt-4">
      {!link ? (
        <>
          <p className="text-sm text-[var(--muted)]">
            No email? Create a reset link.
          </p>
          <Button variant="secondary" className="mt-2" disabled={busy} onClick={create}>
            {busy ? "Creating…" : "Create password reset link"}
          </Button>
          {problem && (
            <div className="mt-2">
              <Notice tone="block">{problem}</Notice>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm font-medium">Reset link for {s.fullName.split(" ")[0]}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Give it to them in person or by private message. It works once, until{" "}
            <span className="figures">{showDateTime(link.expiresAt)}</span>. This has been recorded in the audit log.
          </p>
          <p className="figures mt-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-[13px] break-all select-all">
            {link.url}
          </p>
          <Button variant="secondary" className="mt-2" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </>
      )}
    </div>
  );
}

/** A roster manager at a hospital can be limited to one ward's rosters. */
function WardLimit({ s }: { s: Staff & { account: NonNullable<Staff["account"]> } }) {
  const { isAdmin, facility } = useFacility();
  const depts = useResource<{ departments: { id: string; name: string; active: boolean }[] }>(isAdmin && facility.rosterByWard ? "/api/facility/departments" : null);
  const [value, setValue] = useState(s.account.wardDepartmentId ?? "");
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  if (!isAdmin || !facility.rosterByWard || !["ROSTER_MANAGER", "SUPERVISOR"].includes(s.account.role)) return null;
  async function save(next: string) {
    setValue(next);
    setBusy(true);
    setSay(null);
    try {
      await api.put(`/api/facility/staff/${s.id}/ward`, { departmentId: next || null });
      setSay(next ? "Saved. They now see this ward's rosters only." : "Saved. They can work on every roster.");
    } catch {
      setSay("This could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4">
      <Field label="Rosters they work on" hint="Limit them to one ward's rosters.">
        {(a) => (
          <Select {...a} value={value} disabled={busy} onChange={(e) => save(e.target.value)}>
            <option value="">Every roster</option>
            {(depts.data?.departments ?? []).filter((d) => d.active).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} only
              </option>
            ))}
          </Select>
        )}
      </Field>
      {say && <p className="mt-1 text-sm text-[var(--muted)]">{say}</p>}
    </div>
  );
}

function AccountPanel({ s }: { s: Staff & { account: NonNullable<Staff["account"]> } }) {
  return (
    <Panel title="HealthFlow account">
      <dl className="space-y-2 text-[15px]">
        <div>
          <dt className="text-sm text-[var(--muted)]">Role</dt>
          <dd>{ROLE[s.account.role] ?? s.account.role}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">Access</dt>
          <dd>
            <StatusBadge tone={s.account.active ? "success" : "neutral"}>{s.account.active ? "Can sign in" : "Disabled"}</StatusBadge>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">Two-step sign-in</dt>
          <dd>{s.account.mfaEnabled ? "On" : "Off"}</dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--muted)]">Last signed in</dt>
          <dd className="figures">{s.account.lastSignInAt ? showDateTime(s.account.lastSignInAt) : "Never"}</dd>
        </div>
      </dl>
      <WardLimit s={s} />
      <ResetLink s={s} />
    </Panel>
  );
}

function StaffDetail() {
  const { id } = useParams<{ id: string }>();
  const justAdded = useSearchParams().get("added") === "1";
  const { isAdmin, reload: reloadFacility } = useFacility();
  const { data, error, reload, setData } = useResource<{ staff: Staff; invitation: PendingInvitation | null }>(`/api/facility/staff/${id}`);
  const [editing, setEditing] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  if (error && !data) {
    const missing = "status" in error && error.status === 404;
    return missing ? (
      <Notice tone="warning" action={<Link href="/staff" className="text-[var(--accent-text)] underline">Back to staff</Link>}>
        This staff record does not exist in your facility.
      </Notice>
    ) : (
      <LoadError onRetry={reload} />
    );
  }
  if (!data) return <Loading label="Loading staff record" />;
  const s = data.staff;
  const place = [s.cadre?.name, s.department?.name].filter(Boolean).join(", ");

  return (
    <>
      <p className="mb-2">
        <Link href="/staff" className="inline-flex min-h-11 items-center text-sm text-[var(--accent-text)] underline-offset-4 hover:underline">
          Back to staff
        </Link>
      </p>
      <PageHeader
        title={s.fullName}
        description={
          <>
            <span className="figures">{s.staffNo}</span>
            {place && <span>, {place}</span>}
          </>
        }
        actions={
          isAdmin &&
          !editing && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          )
        }
      />
      {(justAdded || savedNote) && !editing && (
        <div className="mb-4">
          <Notice tone="success">{savedNote ?? `${s.fullName} was added.`}</Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <Panel title={editing ? "Edit details" : "Details"}>
          {editing ? (
            <StaffForm
              staff={s}
              submitLabel="Save changes"
              onSaved={(updated) => {
                setData({ ...data, staff: { ...updated, photo: s.photo } });
                setEditing(false);
                setSavedNote("Changes saved.");
                reloadFacility();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <Details s={s} />
          )}
        </Panel>
        <div className="order-first space-y-6 lg:order-none">
          <StatusPanel
            key={s.status}
            s={s}
            onChanged={(updated) => {
              setData({ ...data, staff: { ...updated, photo: s.photo } });
              setSavedNote(`Status changed to ${STAFF_STATUS[updated.status].label}.`);
            }}
          />
          {isAdmin && <MovePanel s={s} />}
          {s.account ? (
            <AccountPanel s={{ ...s, account: s.account }} />
          ) : (
            <InvitePanel s={s} invitation={data.invitation} isAdmin={isAdmin} onChanged={reload} />
          )}
          {isAdmin && <ConsentPanel s={s} photo={s.photo} onPhotoChanged={reload} />}
          <NoNightsPanel staffId={s.id} />
        </div>
      </div>
    </>
  );
}

export default function StaffDetailPage() {
  return (
    <Suspense fallback={<Loading label="Loading staff record" />}>
      <StaffDetail />
    </Suspense>
  );
}
