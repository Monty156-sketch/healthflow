"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ReactNode, Suspense, useCallback, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { StaffForm } from "@/components/StaffForm";
import { api } from "@/lib/api";
import { useResource, useSave } from "@/lib/useApi";
import { EMPLOYMENT, LEAVING_STATUSES, ROLE, STAFF_STATUS, showDate, showDateTime } from "@/lib/format";
import type { Staff } from "@/lib/types";
import {
  Button,
  ConfirmDialog,
  Field,
  Loading,
  LoadError,
  Notice,
  PageHeader,
  Panel,
  Select,
  StatusBadge,
} from "@/components/ui";

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
      <Row label="Maximum duties per week">
        <span className="figures">{s.maxDutiesPerWeek === 0 ? "No limit" : s.maxDutiesPerWeek}</span>
      </Row>
    </dl>
  );
}

function StatusPanel({ s, onChanged }: { s: Staff; onChanged: (s: Staff) => void }) {
  const { isAdmin, reload } = useFacility();
  const [next, setNext] = useState(s.status);
  const [confirming, setConfirming] = useState(false);
  const change = useCallback(
    async (status: string) => (await api.patch<{ staff: Staff }>(`/api/facility/staff/${s.id}/status`, { status })).staff,
    [s.id]
  );
  const save = useSave(change);
  const current = STAFF_STATUS[s.status];
  const leaving = LEAVING_STATUSES.includes(next);
  const firstName = s.fullName.split(" ")[0];

  async function confirm() {
    const updated = await save.run(next);
    if (updated) {
      setConfirming(false);
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
        {save.state === "failed" && save.message && (
          <div className="mt-3">
            <Notice tone="block">{save.message}</Notice>
          </div>
        )}
      </ConfirmDialog>
    </Panel>
  );
}

function AccountPanel({ s }: { s: Staff }) {
  if (!s.account) {
    return (
      <Panel title="HealthFlow account">
        <p className="text-sm text-[var(--muted)]">
          No account. Inviting staff to sign in arrives in the next step of this phase.
        </p>
      </Panel>
    );
  }
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
    </Panel>
  );
}

function StaffDetail() {
  const { id } = useParams<{ id: string }>();
  const justAdded = useSearchParams().get("added") === "1";
  const { isAdmin, reload: reloadFacility } = useFacility();
  const { data, error, reload, setData } = useResource<{ staff: Staff }>(`/api/facility/staff/${id}`);
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
                setData({ staff: updated });
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
              setData({ staff: updated });
              setSavedNote(`Status changed to ${STAFF_STATUS[updated.status].label}.`);
            }}
          />
          <AccountPanel s={s} />
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
