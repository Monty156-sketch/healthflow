"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { Button, Loading, Notice, Panel, Input } from "@/components/ui";

interface Versions {
  current: number;
  versions: { id: string; version: number; createdAt: string; createdBy: string | null; reason: string | null }[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Earlier states of this roster, saved at approval, publishing, generating again and restoring. */
export function VersionsPanel({ rosterId, canRestore, onRestored, refreshKey }: { rosterId: string; canRestore: boolean; onRestored: () => void; refreshKey: number }) {
  const { data, error, reload } = useResource<Versions>(`/api/facility/rosters/${rosterId}/versions?k=${refreshKey}`);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function restore(vid: string) {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/api/facility/rosters/${rosterId}/versions/${vid}/restore`, { reason: why });
      setConfirming(null);
      setWhy("");
      onRestored();
      reload();
    } catch (err) {
      setProblem(err instanceof ApiError ? ((err.body as { message?: string })?.message ?? "That did not work.") : "That did not work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Saved versions" description="Saved on approve, publish, regenerate and restore.">
      {!data && !error && <Loading label="Loading versions" />}
      {error && !data && <Notice tone="block">The versions could not be loaded.</Notice>}
      {data && data.versions.length === 0 && <p className="text-[15px] text-[var(--muted)]">No versions yet.</p>}
      {problem && (
        <div className="mb-3">
          <Notice tone="block">{problem}</Notice>
        </div>
      )}
      {data && data.versions.length > 0 && (
        <ul className="divide-y divide-[var(--border)]">
          {data.versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[15px]">
              <span>
                <span className="figures font-semibold">Version {v.version}</span>
                <span className="block text-sm text-[var(--muted)]">
                  {v.reason ?? "Saved"}. {when(v.createdAt)}
                  {v.createdBy ? `, ${v.createdBy}` : ""}
                </span>
              </span>
              {canRestore &&
                (confirming === v.id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Input aria-label="Reason for restoring" placeholder="Why restore this version?" value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} className="w-64" />
                    <Button onClick={() => restore(v.id)} disabled={busy || why.trim().length < 5}>
                      {busy ? "Restoring…" : "Restore this version"}
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirming(v.id)}>
                    Restore
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
