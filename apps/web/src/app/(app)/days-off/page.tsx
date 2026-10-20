"use client";

// Days people ask to have off before the roster is made. Staff ask; the
// in-charge decides. Approved days are kept free when the roster is generated.
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, TableScroll, TD, TH } from "@/components/ui";

interface Row { id: string; staffId: string; name: string | null; date: string; reason: string | null; status: "REQUESTED" | "APPROVED" | "DECLINED" | "WITHDRAWN" }
interface Data { requests: Row[]; decider: boolean; perMonth: number; myStaffId: string | null; people: { id: string; name: string }[] }

const STATUS: Record<Row["status"], { word: string; tone: "neutral" | "success" | "warning" | "block" }> = {
  REQUESTED: { word: "Waiting", tone: "warning" },
  APPROVED: { word: "Approved", tone: "success" },
  DECLINED: { word: "Declined", tone: "block" },
  WITHDRAWN: { word: "Withdrawn", tone: "neutral" },
};

export default function DaysOffPage() {
  const { data, error, reload } = useResource<Data>("/api/facility/days-off");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [who, setWho] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading" />;

  async function ask() {
    setBusy(true);
    setFields({});
    setProblem(null);
    try {
      await api.post("/api/facility/days-off", { date, reason: reason || undefined, ...(who ? { staffId: who } : {}) });
      setDate("");
      setReason("");
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { fields?: Record<string, string>; message?: string }) : undefined;
      if (b?.fields) setFields(b.fields);
      else setProblem(b?.message ?? "This could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, path: string, body?: object) {
    setProblem(null);
    try {
      await api.post(`/api/facility/days-off/${id}/${path}`, body ?? {});
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string }) : undefined;
      setProblem(b?.message ?? "This could not be changed. Try again.");
    }
  }

  const waiting = data.requests.filter((r) => r.status === "REQUESTED");
  const canAsk = Boolean(data.myStaffId) || data.decider;

  return (
    <>
      <PageHeader
        title="Days off"
        description={`Ask for a day off before the roster is made, up to ${data.perMonth} days in a month. Approved days are kept free when the roster is generated; days still waiting are avoided where the month allows.`}
      />
      {problem && (
        <div className="mb-4">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      {canAsk && (
        <Panel title={data.decider ? "Set or ask for a day off" : "Ask for a day off"}>
          <div className="grid gap-3 sm:grid-cols-3">
            {data.decider && (
              <Field label="For" hint="Setting a day for someone else approves it at once.">
                {(a) => (
                  <Select {...a} value={who} onChange={(e) => setWho(e.target.value)}>
                    <option value="">{data.myStaffId ? "Myself" : "Choose a person"}</option>
                    {data.people.filter((p) => p.id !== data.myStaffId).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Day" error={fields.date}>
              {(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label="Reason" optional error={fields.reason}>
              {(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          </div>
          <div className="mt-3">
            <Button onClick={ask} disabled={busy || !date || (data.decider && !data.myStaffId && !who)}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </Panel>
      )}

      {data.decider && waiting.length > 0 && (
        <div className="mt-6">
          <Panel title={`Waiting for a decision (${waiting.length})`}>
            <ul className="space-y-3">
              {waiting.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 text-[15px]">
                  <span>
                    <span className="font-medium">{r.name}</span>, {showDate(r.date)}
                    {r.reason && <span className="text-[var(--muted)]"> · {r.reason}</span>}
                  </span>
                  <span className="flex gap-2">
                    <Button onClick={() => act(r.id, "decide", { decision: "approve" })}>Approve</Button>
                    <Button variant="secondary" onClick={() => act(r.id, "decide", { decision: "decline" })}>
                      Decline
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <div className="mt-6">
        <Panel title={data.decider ? "All requests" : "Your requests"}>
          {data.requests.length === 0 ? (
            <EmptyState title="No requests yet" />
          ) : (
            <TableScroll label="Day-off requests">
              <table className="w-full text-[15px]">
                <thead>
                  <tr>
                    {data.decider && <th className={TH}>Name</th>}
                    <th className={TH}>Day</th>
                    <th className={TH}>Reason</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.requests.map((r) => (
                    <tr key={r.id}>
                      {data.decider && <td className={TD}>{r.name}</td>}
                      <td className={TD}>{showDate(r.date)}</td>
                      <td className={TD}>{r.reason ?? ""}</td>
                      <td className={TD}>
                        <StatusBadge tone={STATUS[r.status].tone}>{STATUS[r.status].word}</StatusBadge>
                      </td>
                      <td className={TD}>
                        {(r.status === "REQUESTED" || r.status === "APPROVED") && (r.staffId === data.myStaffId || data.decider) && (
                          <Button variant="quiet" onClick={() => act(r.id, "withdraw")}>
                            Withdraw
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
      </div>
    </>
  );
}
