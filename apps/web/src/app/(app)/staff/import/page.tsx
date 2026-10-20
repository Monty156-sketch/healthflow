"use client";

import Link from "next/link";
import { ChangeEvent, useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { Button, Notice, PageHeader, Panel, Select, StatusBadge, TD, TH, TableScroll, Textarea } from "@/components/ui";

interface Preview {
  headers: string[];
  mapping: Record<string, number>;
  fields: { key: string; label: string }[];
  rows: { row: number; staffNo: string; fullName: string; action: "create" | "update" | "error"; problems: string[] }[];
  totals: { create: number; update: number; error: number };
}
interface Result { created: number; updated: number; skipped: { row: number; staffNo: string; problems: string[] }[] }

export default function ImportPage() {
  const { isAdmin } = useFacility();
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<Record<string, number> | undefined>();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return <Notice tone="warning">Only facility admins can import staff.</Notice>;

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => { setCsv(t); setPreview(null); setResult(null); setMapping(undefined); });
  }
  async function check(m = mapping) {
    setBusy(true);
    setProblem(null);
    setResult(null);
    try {
      const p = await api.post<Preview>("/api/facility/staff-import/preview", { csv, mapping: m });
      setPreview(p);
      setMapping(p.mapping);
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { message?: string; headers?: string[]; mapping?: Record<string, number>; fields?: { key: string; label: string }[] }) : undefined;
      setProblem(b?.message ?? "The file could not be read. Check that it is a CSV file.");
      if (b?.headers && b.fields) { setPreview({ headers: b.headers, mapping: b.mapping ?? {}, fields: b.fields, rows: [], totals: { create: 0, update: 0, error: 0 } }); setMapping(b.mapping ?? {}); }
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setProblem(null);
    try {
      setResult(await api.post<Result>("/api/facility/staff-import/commit", { csv, mapping }));
      setPreview(null);
    } catch {
      setProblem("The import did not run. Nothing was changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Import staff from a file" description="Use the template. Importing again updates people by staff number." actions={<Button variant="secondary" onClick={() => api.download("/api/facility/staff-import/template.csv", "staff-import-template.csv")}>Download the template</Button>} />
      {problem && <Notice tone="block">{problem}</Notice>}
      {result ? (
        <Panel title="Import finished">
          <p className="text-[15px]">{result.created} added, {result.updated} updated, {result.skipped.length} skipped.</p>
          {result.skipped.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-[15px]">
              {result.skipped.map((s) => <li key={s.row}>Row {s.row}{s.staffNo ? ` (${s.staffNo})` : ""}: {s.problems.join(" ")}</li>)}
            </ul>
          )}
          <p className="mt-4"><Link href="/staff" className="text-[var(--accent-text)] underline-offset-2 hover:underline">Go to the staff list</Link></p>
        </Panel>
      ) : (
        <div className="space-y-6">
          <Panel title="1. Choose the file">
            <div className="space-y-3">
              <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label="CSV file" className="block min-h-11 text-[15px]" />
              <details>
                <summary className="min-h-11 cursor-pointer py-2 text-[15px]">Or paste the rows</summary>
                <Textarea rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} aria-label="Pasted rows" />
              </details>
              <Button onClick={() => check()} disabled={busy || csv.trim().length === 0}>Check the file</Button>
            </div>
          </Panel>
          {preview && (
            <Panel title="2. Match the columns">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {preview.fields.map((f) => (
                  <label key={f.key} className="text-sm">
                    <span className="mb-1 block font-medium">{f.label}</span>
                    <Select value={mapping?.[f.key] ?? ""} onChange={(e) => { const m = { ...(mapping ?? {}) }; if (e.target.value === "") delete m[f.key]; else m[f.key] = Number(e.target.value); setMapping(m); }}>
                      <option value="">Not in my file</option>
                      {preview.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </Select>
                  </label>
                ))}
              </div>
              <div className="mt-3"><Button variant="secondary" onClick={() => check(mapping)} disabled={busy}>Check again with these columns</Button></div>
            </Panel>
          )}
          {preview && preview.rows.length > 0 && (
            <Panel title="3. Check the rows">
              <p className="mb-3 text-[15px]">{preview.totals.create} will be added, {preview.totals.update} updated, {preview.totals.error} cannot be imported. Rows with a problem are skipped and the rest go in.</p>
              <TableScroll label="Rows in the file">
                <table className="w-full min-w-[34rem] border-collapse text-[15px]">
                  <thead><tr>{["Row", "Staff number", "Name", "Result"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.row}>
                        <td className={`${TD} figures`}>{r.row}</td>
                        <td className={TD}>{r.staffNo}</td>
                        <td className={TD}>{r.fullName}</td>
                        <td className={TD}>
                          <StatusBadge tone={r.action === "error" ? "block" : r.action === "update" ? "warning" : "success"}>{r.action === "error" ? "Skipped" : r.action === "update" ? "Update" : "Add"}</StatusBadge>
                          {r.problems.length > 0 && <span className="mt-1 block text-sm">{r.problems.join(" ")}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              <div className="mt-4"><Button onClick={commit} disabled={busy || preview.totals.create + preview.totals.update === 0}>Import {preview.totals.create + preview.totals.update} people</Button></div>
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
