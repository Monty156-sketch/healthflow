"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { showDate } from "@/lib/format";
import { Button, Field, Loading, LoadError, Notice, Panel, Select, StatusBadge } from "@/components/ui";

interface Standing { unit: string; label: string; deadline: string; daysLeft: number; state: "OPEN" | "OVERDUE" | "PUBLISHED" | "PUBLISHED_LATE"; status: string }
interface View { day: number | null; standing: Standing[]; late: { unit: string; year: number; month: number; publishedAt: string | null }[] }

const TONE = { OPEN: "neutral", OVERDUE: "block", PUBLISHED: "success", PUBLISHED_LATE: "warning" } as const;
const WORD = (s: Standing) =>
  s.state === "PUBLISHED" ? "Published on time" : s.state === "PUBLISHED_LATE" ? "Published late" : s.state === "OVERDUE" ? `Overdue by ${Math.abs(s.daysLeft)} ${Math.abs(s.daysLeft) === 1 ? "day" : "days"}` : s.daysLeft === 0 ? "Due today" : `Due in ${s.daysLeft} ${s.daysLeft === 1 ? "day" : "days"}`;

/** The day each month's roster must be published by, and where every roster stands against it. */
export function RosterDeadline() {
  const { data, error, reload } = useResource<View>("/api/facility/roster-deadline");
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading />;
  const chosen = day ?? (data.day === null ? "" : String(data.day));

  async function save() {
    setBusy(true); setProblem(null);
    try {
      await api.put("/api/facility/roster-deadline", { day: chosen === "" ? null : Number(chosen) });
      setDay(null);
      reload();
    } catch (e) {
      setProblem(e instanceof ApiError ? "That day was not accepted." : "It was not saved. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return (
    <Panel title="Roster publishing deadline" description="Choose the day of the month before by which each roster must be published. In-charges are reminded 7, 3 and 1 days ahead, and you are told when one is overdue.">
      <div className="flex flex-wrap items-end gap-3">
        <div className="max-w-[16rem]">
          <Field label="Publish by">{(a) => (
            <Select {...a} value={chosen} onChange={(e) => setDay(e.target.value)}>
              <option value="">No deadline</option>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Day {d} of the month before</option>)}
            </Select>
          )}</Field>
        </div>
        <Button disabled={busy || day === null} onClick={save}>{busy ? "Saving…" : "Save deadline"}</Button>
      </div>
      {problem && <div className="mt-3"><Notice tone="block">{problem}</Notice></div>}
      {data.standing.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[15px]">
            <thead>
              <tr className="text-sm text-[var(--muted)]">{["Roster", "Month", "Deadline", "Now", ""].map((h) => <th key={h} className="border-b border-[var(--border-strong)] px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.standing.map((s) => (
                <tr key={`${s.unit}-${s.label}`}>
                  <td className="border-b border-[var(--border)] px-3 py-2">{s.unit}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2">{s.label}</td>
                  <td className="figures border-b border-[var(--border)] px-3 py-2">{showDate(s.deadline)}</td>
                  <td className="border-b border-[var(--border)] px-3 py-2"><StatusBadge tone={TONE[s.state]}>{WORD(s)}</StatusBadge></td>
                  <td className="border-b border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">{s.state === "PUBLISHED" || s.state === "PUBLISHED_LATE" ? "" : s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.late.length > 0 && <p className="mt-3 text-sm text-[var(--muted)]">Published late: {data.late.map((l) => `${l.unit}, ${l.month}/${l.year}`).join("; ")}.</p>}
    </Panel>
  );
}
