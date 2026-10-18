"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { failure, type Say } from "@/lib/adminBits";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, Textarea } from "@/components/ui";

interface A { id: string; title: string; body: string; severity: string; audience: string; facilityIds: string[]; startsAt: string | null; endsAt: string | null; seenBy: number; live: boolean }

export default function AnnouncementsPage() {
  const list = useResource<{ announcements: A[] }>("/api/platform/announcements");
  const facs = useResource<{ facilities: { id: string; name: string }[] }>("/api/platform/facilities");
  const [f, setF] = useState({ title: "", body: "", severity: "INFO", audience: "ALL", facilityIds: [] as string[], endsAt: "" });
  const [say, setSay] = useState<Say>(null);
  if (list.error && !list.data) return <LoadError onRetry={list.reload} />;
  if (!list.data || !facs.data) return <Loading />;
  async function publish(e: FormEvent) {
    e.preventDefault();
    setSay(null);
    try { await api.post("/api/platform/announcements", { ...f, endsAt: f.endsAt || null }); setF({ ...f, title: "", body: "" }); list.reload(); } catch (err) { setSay({ tone: "block", text: failure(err) }); }
  }
  async function end(id: string) { try { await api.post(`/api/platform/announcements/${id}/end`, {}); list.reload(); } catch (err) { setSay({ tone: "block", text: failure(err) }); } }
  return (
    <>
      <PageHeader title="Announcements" description="A message shown inside the application as a banner: planned maintenance, a new feature, a change in how something works. Important ones cannot be dismissed." />
      {say && <Notice tone={say.tone}>{say.text}</Notice>}
      <div className="space-y-6">
        <Panel title="New announcement">
          <form onSubmit={publish} className="max-w-xl space-y-3">
            <Field label="Title">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />}</Field>
            <Field label="Message">{(a) => <Textarea {...a} rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required />}</Field>
            <div className="flex flex-wrap gap-3">
              <Field label="Kind">{(a) => <Select {...a} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="INFO">Information</option><option value="IMPORTANT">Important</option><option value="MAINTENANCE">Maintenance</option></Select>}</Field>
              <Field label="Audience">{(a) => <Select {...a} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="ALL">All facilities</option><option value="SELECTED">Selected facilities</option></Select>}</Field>
              <Field label="Ends" optional>{(a) => <Input {...a} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />}</Field>
            </div>
            {f.audience === "SELECTED" && (
              <fieldset className="max-h-48 overflow-auto rounded-[var(--radius)] border border-[var(--border)] p-3">
                <legend className="px-1 text-sm">Facilities</legend>
                {facs.data.facilities.map((x) => (
                  <label key={x.id} className="flex min-h-11 items-center gap-3 text-[15px]"><input type="checkbox" className="size-5" checked={f.facilityIds.includes(x.id)} onChange={(e) => setF({ ...f, facilityIds: e.target.checked ? [...f.facilityIds, x.id] : f.facilityIds.filter((i) => i !== x.id) })} />{x.name}</label>
                ))}
              </fieldset>
            )}
            <Button type="submit">Publish</Button>
          </form>
        </Panel>
        {list.data.announcements.length === 0 ? <EmptyState title="No announcements yet" /> : (
          <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 text-[15px]">
            {list.data.announcements.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span><strong>{a.title}</strong> <StatusBadge tone={a.live ? "success" : "neutral"}>{a.live ? "live" : "ended"}</StatusBadge><span className="block text-sm text-[var(--muted)]">{a.body} Seen by {a.seenBy} {a.seenBy === 1 ? "facility" : "facilities"}.{a.endsAt ? ` Ends ${showDateTime(a.endsAt)}.` : ""}</span></span>
                {a.live && <Button variant="secondary" onClick={() => end(a.id)}>End now</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
