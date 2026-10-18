"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { showDateTime } from "@/lib/format";
import { failure, type Say } from "@/lib/adminBits";
import { Button, EmptyState, Input, Notice, PageHeader, Select, StatusBadge, TD, TH, TableScroll } from "@/components/ui";

interface U { id: string; email: string; name: string | null; role: string; scope: string; facility: string | null; active: boolean; lastSignInAt: string | null; mfaEnabled: boolean; locked: boolean }
const ROLES = ["STAFF", "SUPERVISOR", "ROSTER_MANAGER", "FACILITY_ADMIN"];

export default function UsersPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<U[] | null>(null);
  const [say, setSay] = useState<Say>(null);
  const [link, setLink] = useState<string | null>(null);

  async function search() { setSay(null); setLink(null); try { setRows((await api.get<{ users: U[] }>(`/api/platform/users?q=${encodeURIComponent(q)}`)).users); } catch (e) { setSay({ tone: "block", text: failure(e) }); } }
  async function act(id: string, path: string, body: object = {}, done = "Done.") {
    setSay(null);
    setLink(null);
    try {
      const r = await api.post<{ url?: string }>(`/api/platform/users/${id}/${path}`, body);
      if (r?.url) setLink(r.url);
      setSay({ tone: "success", text: done });
      await search();
    } catch (e) { setSay({ tone: "block", text: failure(e) }); }
  }
  async function role(id: string, r: string) {
    try { await api.patch(`/api/platform/users/${id}/role`, { role: r }); setSay({ tone: "success", text: "Role changed. It is recorded in the facility's own audit log." }); await search(); } catch (e) { setSay({ tone: "block", text: failure(e) }); }
  }

  return (
    <>
      <PageHeader title="Users" description="Find anyone by name or email. Changes to a facility user are written to that facility's own audit log." />
      {say && <Notice tone={say.tone}>{say.text}</Notice>}
      {link && <div className="my-3"><Notice tone="success">One-time link, shown only now. Send it to the person.<span className="mt-1 block break-all text-sm">{link}</span></Notice></div>}
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="my-4 flex flex-wrap gap-3">
        <Input type="search" aria-label="Name or email" placeholder="Name or email, at least two letters" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Button type="submit" disabled={q.trim().length < 2}>Search</Button>
      </form>
      {rows && (rows.length === 0 ? <EmptyState title="Nobody found" /> : (
        <TableScroll label="Users">
          <table className="w-full min-w-[56rem] border-collapse text-[15px]">
            <thead><tr>{["Person", "Facility", "Role", "Last sign-in", "State", "Actions"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <th scope="row" className={`${TD} text-left font-medium`}>{u.name ?? u.email}<span className="block text-sm font-normal text-[var(--muted)]">{u.email}</span></th>
                  <td className={TD}>{u.facility ?? u.scope.toLowerCase()}</td>
                  <td className={TD}>
                    {u.scope === "FACILITY" ? (
                      <Select aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => role(u.id, e.target.value)} className="w-44">{ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
                    ) : u.role.replace(/_/g, " ").toLowerCase()}
                  </td>
                  <td className={`${TD} figures whitespace-nowrap`}>{u.lastSignInAt ? showDateTime(u.lastSignInAt) : "Never"}</td>
                  <td className={TD}>
                    <StatusBadge tone={u.active ? "success" : "neutral"}>{u.active ? "active" : "inactive"}</StatusBadge>
                    {u.locked && <StatusBadge tone="warning">locked</StatusBadge>}
                    <span className="block text-sm text-[var(--muted)]">{u.mfaEnabled ? "Two-step on" : "Two-step off"}</span>
                  </td>
                  <td className={TD}>
                    {u.role !== "PLATFORM_ADMIN" && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => act(u.id, "reset-link", {}, "Reset link made.")}>Reset link</Button>
                        {u.locked && <Button variant="secondary" onClick={() => act(u.id, "unlock", {}, "Unlocked.")}>Unlock</Button>}
                        {u.mfaEnabled && <Button variant="secondary" onClick={() => { if (window.confirm("Only reset two-step sign-in after you have confirmed who this is by a means outside HealthFlow, such as a telephone call. Continue?")) act(u.id, "reset-mfa", {}, "Two-step sign-in reset. They set it up again at next sign-in."); }}>Reset two-step</Button>}
                        {u.active ? <Button variant="secondary" onClick={() => { if (window.confirm(`Deactivate ${u.email}?`)) act(u.id, "deactivate", {}, "Deactivated."); }}>Deactivate</Button> : <Button variant="secondary" onClick={() => act(u.id, "reactivate", {}, "Reactivated.")}>Reactivate</Button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ))}
    </>
  );
}
