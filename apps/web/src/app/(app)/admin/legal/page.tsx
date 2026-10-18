"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { failure, type Say } from "@/lib/adminBits";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, Textarea } from "@/components/ui";

interface Doc { id: string; slug: string; title: string; version: string; effectiveDate: string | null; publishedAt: string | null; publishedBy: string | null; summaryOfChanges: string | null; material: boolean }
interface Ack { documents: { slug: string; title: string; version: string; publishedAt: string; facilities: { facilityId: string; facility: string; acknowledged: boolean; acknowledgedAt: string | null; by: string | null; outstandingDays: number | null }[] }[] }

export default function LegalConsole() {
  const docs = useResource<{ documents: Doc[] }>("/api/platform/legal");
  const acks = useResource<Ack>("/api/platform/legal/acknowledgements");
  const [f, setF] = useState({ slug: "terms", title: "", version: "", body: "", effectiveDate: "", summaryOfChanges: "", material: false });
  const [say, setSay] = useState<Say>(null);
  if (docs.error && !docs.data) return <LoadError onRetry={docs.reload} />;
  if (!docs.data || !acks.data) return <Loading />;

  async function publish(e: FormEvent) {
    e.preventDefault();
    setSay(null);
    try { await api.post("/api/platform/legal", f); setSay({ tone: "success", text: "Published. It is live on the public page now." }); docs.reload(); acks.reload(); } catch (err) { setSay({ tone: "block", text: failure(err) }); }
  }
  async function load(slug: string) {
    const r = await api.get<{ document: { title: string; version: string; body: string } | null }>(`/api/platform/legal/${slug}/current`);
    if (r.document) setF({ ...f, slug, title: r.document.title, body: r.document.body, version: "", summaryOfChanges: "" });
  }

  return (
    <>
      <PageHeader title="Legal documents" description="Publish a new version of the terms, privacy policy, DPA or security page. Published versions are never edited. Mark a change material to make facility administrators acknowledge it." />
      {say && <Notice tone={say.tone}>{say.text}</Notice>}
      <div className="space-y-6">
        <Panel title="Publish a version">
          <form onSubmit={publish} className="max-w-2xl space-y-3">
            <div className="flex flex-wrap gap-3">
              <Field label="Document">{(a) => <Select {...a} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })}><option value="terms">Terms of Service</option><option value="privacy">Privacy Policy</option><option value="dpa">Data Processing Agreement</option><option value="security">Security</option></Select>}</Field>
              <Field label="Version">{(a) => <Input {...a} value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} required className="w-28" />}</Field>
              <Field label="Effective date">{(a) => <Input {...a} type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} required />}</Field>
            </div>
            <Field label="Title">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />}</Field>
            <Field label="Text" hint="Blank line between paragraphs. Start a line with ## for a heading and with - for a bullet.">{(a) => <Textarea {...a} rows={14} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required />}</Field>
            <Field label="Summary of changes" hint="Shown to facility administrators and in the version history.">{(a) => <Textarea {...a} rows={2} value={f.summaryOfChanges} onChange={(e) => setF({ ...f, summaryOfChanges: e.target.value })} required />}</Field>
            <label className="flex min-h-11 items-start gap-3 text-[15px]"><input type="checkbox" className="mt-1 size-5" checked={f.material} onChange={(e) => setF({ ...f, material: e.target.checked })} /><span>This change is material. Facility administrators must acknowledge it at their next sign-in.</span></label>
            <div className="flex flex-wrap gap-3"><Button type="submit">Publish</Button><Button variant="secondary" onClick={() => load(f.slug)}>Start from the current version</Button></div>
          </form>
        </Panel>
        <Panel title="Published versions">
          {docs.data.documents.length === 0 ? <EmptyState title="Nothing published here yet">The public pages show the built-in draft until you publish a version.</EmptyState> : (
            <ul className="divide-y divide-[var(--border)] text-[15px]">
              {docs.data.documents.map((d) => (
                <li key={d.id} className="py-2"><strong>{d.title}</strong>, version {d.version} {d.material && <StatusBadge tone="warning">material</StatusBadge>}<span className="block text-sm text-[var(--muted)]">Effective {d.effectiveDate ? showDate(d.effectiveDate) : ""}. {d.summaryOfChanges}</span></li>
              ))}
            </ul>
          )}
        </Panel>
        {acks.data.documents.map((d) => (
          <Panel key={d.slug} title={`Acknowledgements: ${d.title}, version ${d.version}`}>
            <ul className="divide-y divide-[var(--border)] text-[15px]">
              {d.facilities.map((x) => (
                <li key={x.facilityId} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{x.facility}</span>
                  {x.acknowledged ? <span className="text-[var(--muted)]">{x.by}, {x.acknowledgedAt ? showDate(x.acknowledgedAt) : ""}</span> : <StatusBadge tone={(x.outstandingDays ?? 0) > 14 ? "block" : "warning"}>outstanding {x.outstandingDays} days</StatusBadge>}
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
