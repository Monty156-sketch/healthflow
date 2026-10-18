"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { failure, type Say } from "@/lib/adminBits";
import { Button, EmptyState, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, StatusBadge } from "@/components/ui";

interface Flag { id: string; key: string; description: string | null; enabledGlobally: boolean; enabledForFacilityIds: string[] }

export default function FlagsPage() {
  const flags = useResource<{ flags: Flag[] }>("/api/platform/flags");
  const facs = useResource<{ facilities: { id: string; name: string }[] }>("/api/platform/facilities");
  const [key, setKey] = useState("");
  const [desc, setDesc] = useState("");
  const [say, setSay] = useState<Say>(null);
  if (flags.error && !flags.data) return <LoadError onRetry={flags.reload} />;
  if (!flags.data || !facs.data) return <Loading />;
  async function save(f: Pick<Flag, "key" | "description" | "enabledGlobally" | "enabledForFacilityIds">) {
    setSay(null);
    try { await api.put(`/api/platform/flags/${f.key}`, { description: f.description, enabledGlobally: f.enabledGlobally, enabledForFacilityIds: f.enabledForFacilityIds }); flags.reload(); } catch (e) { setSay({ tone: "block", text: failure(e) }); }
  }
  async function create(e: FormEvent) { e.preventDefault(); await save({ key, description: desc || null, enabledGlobally: false, enabledForFacilityIds: [] }); setKey(""); setDesc(""); }
  return (
    <>
      <PageHeader title="Feature flags" description="Turn a capability on for one facility without a release, for example to pilot district oversight with a single directorate." />
      {say && <Notice tone={say.tone}>{say.text}</Notice>}
      <div className="space-y-6">
        <Panel title="New flag">
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <Field label="Key" hint="For example district.oversight">{(a) => <Input {...a} value={key} onChange={(e) => setKey(e.target.value)} required />}</Field>
            <Field label="What it does" optional>{(a) => <Input {...a} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
            <Button type="submit">Create</Button>
          </form>
        </Panel>
        {flags.data.flags.length === 0 ? <EmptyState title="No flags yet" /> : flags.data.flags.map((f) => (
          <Panel key={f.id} title={f.key}>
            {f.description && <p className="mb-2 text-[15px] text-[var(--muted)]">{f.description}</p>}
            <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="checkbox" className="size-5" checked={f.enabledGlobally} onChange={(e) => save({ ...f, enabledGlobally: e.target.checked })} />On for every facility {f.enabledGlobally && <StatusBadge tone="success">on</StatusBadge>}</label>
            {!f.enabledGlobally && (
              <fieldset className="mt-2 max-h-48 overflow-auto"><legend className="text-sm text-[var(--muted)]">On for these facilities</legend>
                {facs.data!.facilities.map((x) => (
                  <label key={x.id} className="flex min-h-11 items-center gap-3 text-[15px]"><input type="checkbox" className="size-5" checked={f.enabledForFacilityIds.includes(x.id)} onChange={(e) => save({ ...f, enabledForFacilityIds: e.target.checked ? [...f.enabledForFacilityIds, x.id] : f.enabledForFacilityIds.filter((i) => i !== x.id) })} />{x.name}</label>
                ))}
              </fieldset>
            )}
          </Panel>
        ))}
      </div>
    </>
  );
}
