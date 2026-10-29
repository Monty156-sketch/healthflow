"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDateTime } from "@/lib/format";
import { failure, type Say } from "@/lib/adminBits";
import { Button, EmptyState, Field, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusBadge, Textarea } from "@/components/ui";

interface Row { id: string; createdAt: string; facility: string; from: string; role: string; rating: number; category: string; message: string | null; screen: string | null; asked: boolean; status: "NEW" | "READ" | "ACTIONED"; note: string | null }
interface Data { summary: { total: number; average: number | null; byRating: Record<string, number>; unread: number }; feedback: Row[] }

const CATEGORY = { GENERAL: "General comment", IDEA: "Idea", PROBLEM: "Problem", PRAISE: "Praise" } as Record<string, string>;
const tone = (r: number) => (r >= 4 ? "success" : r === 3 ? "warning" : "block") as "success" | "warning" | "block";

export default function FeedbackPage() {
  const [status, setStatus] = useState("");
  const [rating, setRating] = useState("");
  const [category, setCategory] = useState("");
  const [days, setDays] = useState("90");
  const query = new URLSearchParams({ ...(status ? { status } : {}), ...(rating ? { rating } : {}), ...(category ? { category } : {}), ...(days ? { days } : {}) }).toString();
  const { data, error, reload } = useResource<Data>(`/api/platform/feedback${query ? `?${query}` : ""}`);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const [say, setSay] = useState<Say>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;

  async function mark(id: string, body: { status?: string; note?: string }) {
    setSay(null);
    try { await api.patch(`/api/platform/feedback/${id}`, body); setNote(null); reload(); } catch (e) { setSay({ tone: "block", text: failure(e) }); }
  }
  const max = Math.max(1, ...Object.values(data.summary.byRating));

  return (
    <>
      <PageHeader title="User feedback" description="What people tell us through the reminder and the Give feedback button. Use it to decide what to improve next." />
      {say && <Notice tone={say.tone}>{say.text}</Notice>}

      <div className="mb-4 grid gap-4 md:grid-cols-[14rem_1fr]">
        <Panel title="Summary">
          <p className="figures text-3xl font-semibold">{data.summary.average ?? "–"}<span className="text-base font-normal text-[var(--muted)]"> out of 5</span></p>
          <p className="text-sm text-[var(--muted)]">{data.summary.total} {data.summary.total === 1 ? "response" : "responses"} in this view</p>
          <p className="mt-1 text-sm">{data.summary.unread} not yet read</p>
        </Panel>
        <Panel title="Ratings">
          <ul className="space-y-1.5 text-sm" aria-label="Number of responses for each rating">
            {[5, 4, 3, 2, 1].map((n) => {
              const c = data.summary.byRating[String(n)] ?? 0;
              return (
                <li key={n} className="flex items-center gap-2">
                  <span className="figures w-14">{n} {n === 1 ? "star" : "stars"}</span>
                  <span className="h-3 flex-1 rounded-[2px] bg-[var(--surface-2)]"><span className="block h-3 rounded-[2px] bg-[var(--accent)]" style={{ width: `${(c / max) * 100}%` }} /></span>
                  <span className="figures w-8 text-right">{c}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Status">{(a) => <Select {...a} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="NEW">Not yet read</option><option value="READ">Read</option><option value="ACTIONED">Acted on</option></Select>}</Field>
        <Field label="Rating">{(a) => <Select {...a} value={rating} onChange={(e) => setRating(e.target.value)}><option value="">All</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</Select>}</Field>
        <Field label="About">{(a) => <Select {...a} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Period">{(a) => <Select {...a} value={days} onChange={(e) => setDays(e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="">All time</option></Select>}</Field>
      </div>

      {data.feedback.length === 0 ? <EmptyState title="No feedback in this view" /> : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 text-[15px]">
          {data.feedback.map((f) => (
            <li key={f.id} className="py-3">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge tone={tone(f.rating)}>{f.rating} out of 5</StatusBadge>
                <span className="font-medium">{CATEGORY[f.category] ?? f.category}</span>
                <span className="figures text-sm text-[var(--muted)]">{showDateTime(f.createdAt)}</span>
                {f.status === "NEW" && <StatusBadge tone="neutral">not yet read</StatusBadge>}
                {f.status === "ACTIONED" && <StatusBadge tone="success">acted on</StatusBadge>}
              </p>
              {f.message ? <p className="mt-1 whitespace-pre-wrap">{f.message}</p> : <p className="mt-1 text-[var(--muted)]">No comment.</p>}
              <p className="text-sm text-[var(--muted)]">{f.facility}, {f.role.replace(/_/g, " ").toLowerCase()}, {f.from}{f.screen ? `, on ${f.screen}` : ""}{f.asked ? "" : ", sent unprompted"}</p>
              {f.note && note?.id !== f.id && <p className="mt-1 text-sm">Our note: {f.note}</p>}
              {note?.id === f.id ? (
                <div className="mt-2 max-w-xl space-y-2">
                  <Textarea aria-label="Note for PS Tech, not shown to the user" rows={2} value={note.text} onChange={(e) => setNote({ id: f.id, text: e.target.value })} />
                  <div className="flex gap-2"><Button onClick={() => mark(f.id, { note: note.text })}>Save note</Button><Button variant="secondary" onClick={() => setNote(null)}>Cancel</Button></div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {f.status !== "READ" && <Button variant="secondary" onClick={() => mark(f.id, { status: "READ" })}>Mark read</Button>}
                  {f.status !== "ACTIONED" && <Button variant="secondary" onClick={() => mark(f.id, { status: "ACTIONED" })}>Mark acted on</Button>}
                  <Button variant="secondary" onClick={() => setNote({ id: f.id, text: f.note ?? "" })}>{f.note ? "Edit note" : "Add note"}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
