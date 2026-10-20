"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Input, Loading, LoadError, Notice, PageHeader, TD, TH, TableScroll } from "@/components/ui";

interface Data {
  posts: { cadreId: string; cadre: string; approved: number; filled: number; vacancies: number }[];
}

export default function EstablishmentSettings() {
  const { data, error, reload } = useResource<Data>("/api/facility/directorate/establishment");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "success" | "block"; text: string } | null>(null);
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading approved posts" />;

  async function save() {
    setMsg(null);
    try {
      const posts = Object.entries(edit).map(([cadreId, v]) => ({ cadreId, approvedCount: Number(v) }));
      await api.put("/api/facility/directorate/establishment", { posts });
      setEdit({});
      setMsg({ tone: "success", text: "Saved." });
      reload();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { fields?: Record<string, string> }) : undefined;
      setMsg({ tone: "block", text: b?.fields ? Object.values(b.fields)[0] : "It was not saved. Try again." });
    }
  }

  return (
    <>
      <PageHeader title="Approved posts" description="Approved posts per cadre." />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <TableScroll label="Approved posts by cadre">
        <table className="w-full min-w-[30rem] border-collapse text-[15px]">
          <thead>
            <tr>
              {["Cadre", "Approved", "In post", "Vacancies"].map((h) => (
                <th key={h} scope="col" className={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.posts.map((p) => (
              <tr key={p.cadreId}>
                <th scope="row" className={`${TD} text-left font-medium`}>{p.cadre}</th>
                <td className={TD}>
                  <Input type="number" min={0} max={5000} inputMode="numeric" aria-label={`Approved posts for ${p.cadre}`} className="w-24" value={edit[p.cadreId] ?? String(p.approved)} onChange={(e) => setEdit({ ...edit, [p.cadreId]: e.target.value })} />
                </td>
                <td className={`${TD} figures`}>{p.filled}</td>
                <td className={`${TD} figures`}>{Math.max(0, Number(edit[p.cadreId] ?? p.approved) - p.filled)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <div className="mt-4">
        <Button onClick={save} disabled={Object.keys(edit).length === 0}>Save approved posts</Button>
      </div>
    </>
  );
}
