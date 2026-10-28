"use client";

// Panels on the staff record for giving someone access: the invitation, and
// the consent records with the optional photograph.
import { WardSelect } from "@/components/WardSelect";
import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { ROLE, showDateTime } from "@/lib/format";
import type { Staff } from "@/lib/types";
import { Button, ConfirmDialog, Field, Loading, LoadError, Notice, Panel, Select, StatusBadge } from "@/components/ui";

function messageOf(err: unknown, fallback: string) {
  const body = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
  return body?.message ?? fallback;
}

export interface PendingInvitation {
  id: string;
  role: string;
  email: string | null;
  sentAt: string;
  expiresAt: string;
}

const INVITE_ROLES = ["STAFF", "SUPERVISOR", "ROSTER_MANAGER", "FACILITY_ADMIN"];

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <p className="figures mt-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-[13px] break-all select-all">
        {url}
      </p>
      <Button
        variant="secondary"
        className="mt-2"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
    </>
  );
}

/** Shown in place of the account details when the person has no account yet. */
export function InvitePanel({ s, invitation, isAdmin, onChanged }: { s: Staff; invitation: PendingInvitation | null; isAdmin: boolean; onChanged: () => void }) {
  const [role, setRole] = useState(invitation?.role ?? "STAFF");
  const [ward, setWard] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<{ url: string; expiresAt: string; emailed: boolean } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const first = s.fullName.split(" ")[0];

  async function send() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await api.post<{ url: string; expiresAt: string; emailed: boolean }>(`/api/facility/staff/${s.id}/invite`, { role, wardDepartmentId: ward || null });
      setSent(res);
      onChanged();
    } catch (err) {
      setProblem(messageOf(err, "The invitation could not be created. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.post(`/api/facility/staff/${s.id}/invite/revoke`);
      setSent(null);
      setCancelling(false);
      onChanged();
    } catch (err) {
      setProblem(messageOf(err, "The invitation could not be cancelled. Try again."));
      setCancelling(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="HealthFlow account">
      {sent ? (
        <>
          <p className="text-sm font-medium">Invitation for {first}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {sent.emailed ? `It has also been emailed to ${s.email}. ` : "It has not been emailed. "}
            Give {first} this link in person or by private message. It works until{" "}
            <span className="figures">{showDateTime(sent.expiresAt)}</span>. Anyone who has the link can create the account, so share it only with {first}.
          </p>
          <CopyLink url={sent.url} />
        </>
      ) : invitation ? (
        <p className="text-sm">
          <StatusBadge tone="warning">Invited</StatusBadge>
          <span className="mt-2 block text-[var(--muted)]">
            As {ROLE[invitation.role] ?? invitation.role}, sent <span className="figures">{showDateTime(invitation.sentAt)}</span>, valid until{" "}
            <span className="figures">{showDateTime(invitation.expiresAt)}</span>. The link itself is not stored, so to give {first} a link again, send a new
            invitation. That cancels this one.
          </span>
        </p>
      ) : (
        <p className="text-sm text-[var(--muted)]">No account yet. {first} cannot sign in.</p>
      )}

      {isAdmin && !sent && (
        <div className="mt-4 space-y-3">
          <Field label="Role">
            {(a) => (
              <Select {...a} value={role} onChange={(e) => setRole(e.target.value)}>
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {(role === "ROSTER_MANAGER" || role === "SUPERVISOR") && <WardSelect value={ward} onChange={setWard} allLabel="Every roster" label="Rosters they work on" />}
          {role === "FACILITY_ADMIN" && (
            <p className="text-sm text-[var(--muted)]">Facility admins, in-charges and supervisors must set up two-step sign-in before their first session.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={send}>
              {busy ? "Working…" : invitation ? "Send a new invitation" : "Create invitation"}
            </Button>
            {invitation && (
              <Button variant="secondary" disabled={busy} onClick={() => setCancelling(true)}>
                Cancel invitation
              </Button>
            )}
          </div>
        </div>
      )}
      {problem && (
        <div className="mt-3">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      <ConfirmDialog
        open={cancelling}
        title={`Cancel ${first}'s invitation?`}
        confirmLabel="Cancel invitation"
        tone="danger"
        busy={busy}
        onConfirm={cancel}
        onCancel={() => setCancelling(false)}
      >
        <p>The link stops working. You can invite {first} again later.</p>
      </ConfirmDialog>
    </Panel>
  );
}

// ------------------------------------------------------------- consent and photograph

interface ConsentRow {
  consentType: string;
  active: boolean;
  latest: { id: string; grantedAt: string; withdrawnAt: string | null; recordedBy: string | null; notes: string | null } | null;
}

const CONSENT_LABEL: Record<string, { title: string; help: string }> = {
  PHOTOGRAPH: {
    title: "Photograph on their record",
    help: "Optional. A photograph is held only while this consent stands. Withdrawing it deletes the photograph.",
  },
};

/** Draws the chosen image onto a 256px square and returns a JPEG data URL. */
async function shrinkToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function ConsentPanel({ s, photo, onPhotoChanged }: { s: Staff; photo: string | null | undefined; onPhotoChanged: () => void }) {
  const { data, error, reload } = useResource<{ consents: ConsentRow[] }>(`/api/facility/staff/${s.id}/consents`);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<ConsentRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const first = s.fullName.split(" ")[0];

  const run = useCallback(
    async (fn: () => Promise<unknown>, fail: string) => {
      setBusy(true);
      setProblem(null);
      try {
        await fn();
        reload();
        onPhotoChanged();
      } catch (err) {
        setProblem(messageOf(err, fail));
      } finally {
        setBusy(false);
      }
    },
    [reload, onPhotoChanged]
  );

  async function choose(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProblem("Choose an image file, such as a JPEG or PNG.");
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await shrinkToJpeg(file);
    } catch {
      setProblem("That image could not be read. Try a different photograph.");
      return;
    }
    await run(() => api.put(`/api/facility/staff/${s.id}/photo`, { dataUrl }), "The photograph could not be saved. Try again.");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Panel title="Consent">
      {error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {data.consents.map((c) => {
            const info = CONSENT_LABEL[c.consentType] ?? { title: c.consentType, help: "" };
            return (
              <li key={c.consentType} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{info.title}</p>
                  <StatusBadge tone={c.active ? "success" : "neutral"}>{c.active ? "Given" : c.latest?.withdrawnAt ? "Withdrawn" : "Not given"}</StatusBadge>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">{info.help}</p>
                {c.latest && (
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Recorded <span className="figures">{showDateTime(c.latest.grantedAt)}</span>
                    {c.latest.withdrawnAt && (
                      <>
                        , withdrawn <span className="figures">{showDateTime(c.latest.withdrawnAt)}</span>
                      </>
                    )}
                    .
                  </p>
                )}
                {c.consentType === "PHOTOGRAPH" && c.active && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt={`Photograph of ${s.fullName}`} width={72} height={72} className="size-[72px] rounded-[var(--radius)] border border-[var(--border)] object-cover" />
                    ) : (
                      <p className="text-sm text-[var(--muted)]">No photograph added yet.</p>
                    )}
                    <input
                      ref={fileRef}
                      id="photo-file"
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => void choose(e.target.files?.[0])}
                    />
                    <label
                      htmlFor="photo-file"
                      className="inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[15px] font-medium hover:bg-[var(--accent-soft)] focus-within:outline-2"
                    >
                      {photo ? "Replace photograph" : "Add photograph"}
                    </label>
                    {photo && (
                      <Button variant="secondary" disabled={busy} onClick={() => run(() => api.delete(`/api/facility/staff/${s.id}/photo`), "The photograph could not be removed. Try again.")}>
                        Remove photograph
                      </Button>
                    )}
                  </div>
                )}
                <div className="mt-3">
                  {c.active ? (
                    <Button variant="secondary" disabled={busy} onClick={() => setWithdrawing(c)}>
                      Record withdrawal
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => run(() => api.post(`/api/facility/staff/${s.id}/consents`, { consentType: c.consentType }), "The consent could not be recorded. Try again.")}
                    >
                      Record that {first} agreed
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {problem && (
        <div className="mt-3">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(withdrawing)}
        title={`Record that ${first} withdrew consent?`}
        confirmLabel="Record withdrawal"
        tone="danger"
        busy={busy}
        onConfirm={async () => {
          const c = withdrawing;
          if (!c?.latest) return;
          await run(() => api.post(`/api/facility/staff/${s.id}/consents/${c.latest!.id}/withdraw`), "The withdrawal could not be recorded. Try again.");
          setWithdrawing(null);
        }}
        onCancel={() => setWithdrawing(null)}
      >
        <p>
          {withdrawing?.consentType === "PHOTOGRAPH" && photo ? "Their photograph will be deleted now. " : ""}
          The withdrawal is recorded in the audit log.
        </p>
      </ConfirmDialog>
    </Panel>
  );
}
