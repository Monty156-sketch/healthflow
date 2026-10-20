"use client";

// Invite staff: type a name and an email, choose a role, and get a link the
// person uses to set their own password and authenticator app. Below, every
// invitation so far with what is still waiting.
import { WardSelect } from "@/components/WardSelect";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { ROLE, showDateTime } from "@/lib/format";
import type { Cadre, Department } from "@/lib/types";
import {
  Button,
  EmptyState,
  Field,
  Input,
  Loading,
  LoadError,
  Notice,
  PageHeader,
  Panel,
  Select,
  StatusBadge,
  TD,
  TH,
  TableScroll,
} from "@/components/ui";
import type { StatusTone } from "@/components/ui";

const ROLES = ["STAFF", "SUPERVISOR", "ROSTER_MANAGER", "FACILITY_ADMIN"];
const ROLE_HINT: Record<string, string> = {
  STAFF: "Sees their own duties and leave.",
  SUPERVISOR: "Can view staff and rosters.",
  ROSTER_MANAGER: "Builds and publishes rosters.",
  FACILITY_ADMIN: "Manages everything in the facility.",
};

interface Invitation {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: "waiting" | "expired" | "joined";
  sentAt: string;
  expiresAt: string;
}

interface Sent {
  url: string;
  expiresAt: string;
  emailed: boolean;
  name: string;
  email: string;
}

const STATUS: Record<Invitation["status"], { label: string; tone: StatusTone }> = {
  waiting: { label: "Waiting", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  joined: { label: "Joined", tone: "success" },
};

function messageOf(err: unknown, fallback: string) {
  const body = err instanceof ApiError ? (err.body as { message?: string }) : undefined;
  return body?.message ?? fallback;
}

function LinkCard({ sent, onDone }: { sent: Sent; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const first = sent.name.split(" ")[0];
  const text = `Hello ${first}, you have been invited to HealthFlow. Open this link to create your account (it works for 7 days): ${sent.url}`;
  return (
    <Panel title={`Invitation for ${sent.name}`}>
      <p className="text-[15px]">
        {sent.emailed ? (
          <>
            The link was emailed to <span className="font-medium">{sent.email}</span>. You can also pass it on yourself.
          </>
        ) : (
          <>Email is not sending from HealthFlow yet, so give {first} this link yourself, in person or on WhatsApp.</>
        )}
      </p>
      <p className="mt-1 text-sm text-[var(--muted)]">
        It works until <span className="figures">{showDateTime(sent.expiresAt)}</span>. Anyone with the link can create the account, so share it only with {first}.
      </p>
      <p className="figures mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-[13px] break-all select-all">{sent.url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(sent.url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm font-medium hover:bg-[var(--accent-soft)]"
        >
          Send on WhatsApp
        </a>
        <Button variant="secondary" onClick={onDone}>
          Invite someone else
        </Button>
      </div>
      <p className="mt-4 text-sm text-[var(--muted)]">
        {first} will read the privacy notice, choose a password, and set up an authenticator app on their phone. The app shows a 6-digit code that they enter with
        their email and password every time they sign in.
      </p>
    </Panel>
  );
}

function InviteForm({ cadres, departments, onSent }: { cadres: Cadre[]; departments: Department[]; onSent: (s: Sent) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("STAFF");
  const [ward, setWard] = useState("");
  const [staffNo, setStaffNo] = useState("");
  const [cadreId, setCadreId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFields({});
    setProblem(null);
    try {
      const res = await api.post<{ url: string; expiresAt: string; emailed: boolean; name: string }>("/api/facility/invitations", {
        fullName,
        email,
        role,
        staffNo: staffNo || null,
        cadreId: cadreId || null,
        departmentId: departmentId || null,
        wardDepartmentId: ward || null,
      });
      onSent({ ...res, email: email.trim().toLowerCase() });
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { fields?: Record<string, string>; message?: string }) : undefined;
      setFields(body?.fields ?? {});
      setProblem(body?.fields ? "Some details need correcting. They are marked below." : messageOf(err, "The invitation could not be created. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={fields.fullName}>
          {(a) => <Input {...a} autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} />}
        </Field>
        <Field label="Email address" hint="They will sign in with this." error={fields.email}>
          {(a) => <Input {...a} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
      </div>
      <Field label="Role" hint={ROLE_HINT[role]} error={fields.role}>
        {(a) => (
          <Select {...a} value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE[r]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {(role === "ROSTER_MANAGER" || role === "SUPERVISOR") && <WardSelect value={ward} onChange={setWard} allLabel="Every roster" label="Rosters they work on" />}
      <details className="rounded-[var(--radius)] border border-[var(--border)]">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">Add their staff details now (optional)</summary>
        <div className="grid gap-4 border-t border-[var(--border)] p-3 sm:grid-cols-3">
          <Field label="Staff number" optional error={fields.staffNo}>
            {(a) => <Input {...a} value={staffNo} onChange={(e) => setStaffNo(e.target.value)} />}
          </Field>
          <Field label="Cadre" optional error={fields.cadreId}>
            {(a) => (
              <Select {...a} value={cadreId} onChange={(e) => setCadreId(e.target.value)}>
                <option value="">Not set</option>
                {cadres.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Department" optional error={fields.departmentId}>
            {(a) => (
              <Select {...a} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">Not set</option>
                {departments.filter((d) => d.active).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </details>
      {problem && <Notice tone="block">{problem}</Notice>}
      <Button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create invitation"}
      </Button>
    </form>
  );
}

function InvitationsTable({ onResent }: { onResent: (s: Sent) => void }) {
  const { data, error, reload } = useResource<{ invitations: Invitation[] }>("/api/facility/invitations");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;
  if (data.invitations.length === 0) {
    return <EmptyState title="No invitations yet">People you invite appear here, with whether they have joined.</EmptyState>;
  }

  async function act(i: Invitation, kind: "resend" | "revoke") {
    setBusyId(i.id);
    setProblem(null);
    try {
      if (kind === "revoke") {
        await api.post(`/api/facility/invitations/${i.id}/revoke`);
        reload();
      } else {
        const res = await api.post<{ url: string; expiresAt: string; emailed: boolean; name: string }>(`/api/facility/invitations/${i.id}/resend`);
        onResent({ ...res, email: i.email });
        reload();
      }
    } catch (err) {
      setProblem(messageOf(err, "This could not be done. Try again."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {problem && (
        <div className="mb-3">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      <TableScroll label="Invitations">
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              <th className={TH}>Person</th>
              <th className={TH}>Role</th>
              <th className={TH}>Status</th>
              <th className={TH}>Sent</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.invitations.map((i) => (
              <tr key={i.id}>
                <td className={TD}>
                  <span className="font-medium">{i.fullName}</span>
                  <span className="block text-sm text-[var(--muted)]">{i.email}</span>
                </td>
                <td className={TD}>{ROLE[i.role] ?? i.role}</td>
                <td className={TD}>
                  <StatusBadge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</StatusBadge>
                  {i.status === "waiting" && <span className="mt-1 block text-sm text-[var(--muted)]">Until <span className="figures">{showDateTime(i.expiresAt)}</span></span>}
                </td>
                <td className={`${TD} figures whitespace-nowrap`}>{showDateTime(i.sentAt)}</td>
                <td className={TD}>
                  {i.status !== "joined" && (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" disabled={busyId === i.id} onClick={() => act(i, "resend")}>
                        Send a new link
                      </Button>
                      {i.status === "waiting" && (
                        <Button variant="quiet" disabled={busyId === i.id} onClick={() => act(i, "revoke")}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </>
  );
}

export default function InviteStaffPage() {
  const { isAdmin } = useFacility();
  const cadres = useResource<{ cadres: Cadre[] }>("/api/facility/cadres");
  const departments = useResource<{ departments: Department[] }>("/api/facility/departments");
  const [sent, setSent] = useState<Sent | null>(null);
  const [formKey, setFormKey] = useState(0);

  if (!isAdmin) return <Notice tone="warning">Only facility admins can invite staff.</Notice>;

  return (
    <>
      <p className="mb-2">
        <Link href="/staff" className="inline-flex min-h-11 items-center text-sm text-[var(--accent-text)] underline-offset-4 hover:underline">
          Back to staff
        </Link>
      </p>
      <PageHeader
        title="Invite staff"
        description="They get a link to set their password."
      />
      <div className="space-y-6">
        {sent ? (
          <LinkCard
            sent={sent}
            onDone={() => {
              setSent(null);
              setFormKey((k) => k + 1);
            }}
          />
        ) : (
          <Panel title="Invite someone">
            <InviteForm key={formKey} cadres={cadres.data?.cadres ?? []} departments={departments.data?.departments ?? []} onSent={setSent} />
          </Panel>
        )}
        <section aria-labelledby="inv-h">
          <h2 id="inv-h" className="mb-3 text-lg font-semibold">
            Invitations
          </h2>
          <InvitationsTable key={sent?.url ?? "none"} onResent={setSent} />
        </section>
      </div>
    </>
  );
}
