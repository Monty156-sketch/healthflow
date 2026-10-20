"use client";

import { useState } from "react";
import { useFacility } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import type { Rule } from "@/lib/types";
import { Button, Checkbox, Field, Input, Loading, LoadError, Notice, PageHeader, Select, StatusBadge, TD, TH, TableScroll, Textarea } from "@/components/ui";
import type { StatusTone } from "@/components/ui";

const TYPE: Record<Rule["ruleType"], { label: string; tone: StatusTone }> = {
  STATUTORY: { label: "Statutory", tone: "warning" },
  POLICY: { label: "Policy", tone: "neutral" },
  LOGICAL: { label: "Fixed", tone: "neutral" },
  FACILITY: { label: "Facility", tone: "neutral" },
  FAIRNESS: { label: "Fairness", tone: "neutral" },
};

const BEHAVIOUR: Record<Rule["behaviour"], string> = { BLOCK: "Blocks", WARN: "Warns", OPTIMISE: "Shapes generation" };

function RuleRow({ r, isAdmin, onChanged }: { r: Rule; isAdmin: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(r.thresholdValue === null ? "" : String(r.thresholdValue));
  const [behaviour, setBehaviour] = useState<"BLOCK" | "WARN">(r.behaviour === "BLOCK" ? "BLOCK" : "WARN");
  const [enabled, setEnabled] = useState(r.enabled);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const changedThreshold = r.editable.threshold && Number(value) !== r.thresholdValue;
  const statutoryChange = r.ruleType === "STATUTORY" && changedThreshold;
  const canEdit = isAdmin && (r.editable.threshold || r.editable.behaviour || r.editable.enabled);

  async function save() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api.patch(`/api/facility/rules/${r.code}`, {
        ...(r.editable.threshold ? { thresholdValue: Number(value) } : {}),
        ...(r.editable.behaviour ? { behaviour } : {}),
        ...(r.editable.enabled ? { enabled } : {}),
        ...(statutoryChange ? { confirmStatutory: confirm, reason } : {}),
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string; fields?: Record<string, string> }) : undefined;
      setFields(body?.fields ?? {});
      setError(body?.fields ? null : (body?.message ?? "This could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={r.enabled ? "" : "text-[var(--muted)]"}>
      <td className={`${TD} figures font-semibold`}>{r.code}</td>
      <td className={TD}>
        <span className="font-medium">{r.name}</span>
        {r.description && <span className="block max-w-[48ch] text-sm text-[var(--muted)]">{r.description}</span>}
        {!r.overridable && r.ruleType !== "FAIRNESS" && <span className="block text-sm text-[var(--muted)]">Cannot be overridden.</span>}
      </td>
      <td className={TD}>
        <StatusBadge tone={TYPE[r.ruleType].tone}>{TYPE[r.ruleType].label}</StatusBadge>
      </td>
      <td className={TD}>
        {editing ? (
          <div className="min-w-60 space-y-3">
            {r.editable.threshold && (
              <Field label={`Threshold (${r.unit})`} error={fields.thresholdValue} hint={r.standard !== null ? `Standard: ${r.standard}` : undefined}>
                {(a) => <Input {...a} inputMode="decimal" className="figures" value={value} onChange={(e) => setValue(e.target.value)} />}
              </Field>
            )}
            {r.editable.behaviour && (
              <Field label="When it is broken">
                {(a) => (
                  <Select {...a} value={behaviour} onChange={(e) => setBehaviour(e.target.value as "BLOCK" | "WARN")}>
                    <option value="BLOCK">Block: the roster cannot be published until fixed or overridden</option>
                    <option value="WARN">Warn: shown, but the roster can still be published</option>
                  </Select>
                )}
              </Field>
            )}
            {r.editable.enabled && <Checkbox label="This rule is on" checked={enabled} onChange={setEnabled} />}
            {statutoryChange && (
              <div className="space-y-2">
                <Notice tone="warning">
                  Set by the Labour Act. Change only on legal advice.
                </Notice>
                <Field label="The advice this is based on" error={fields.reason}>
                  {(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
                </Field>
                <Checkbox label="I have taken that advice" checked={confirm} onChange={setConfirm} />
              </div>
            )}
            {error && <p className="text-sm text-[var(--status-block)]">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || (statutoryChange && !confirm)} onClick={save}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : r.thresholdValue !== null ? (
          <span className="figures whitespace-nowrap">
            {r.thresholdValue} {r.unit}
          </span>
        ) : (
          <span className="text-[var(--muted)]">Set by shifts and staff</span>
        )}
      </td>
      <td className={TD}>
        {r.enabled ? BEHAVIOUR[r.behaviour] : <StatusBadge tone="neutral">Off</StatusBadge>}
      </td>
      <td className={TD}>
        {canEdit && !editing && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </td>
    </tr>
  );
}

export default function RulesPage() {
  const { isAdmin } = useFacility();
  const { data, error, reload } = useResource<{ rules: Rule[] }>("/api/facility/rules");
  if (error && !data) return <LoadError onRetry={reload} />;
  if (!data) return <Loading label="Loading rules" />;
  return (
    <>
      <PageHeader title="Compliance rules" description="The twelve checks every roster is held against." />
      <div className="mb-4">
        <Notice>
          Statutory limits are from the Labour Act 2003 (Act 651).
        </Notice>
      </div>
      <TableScroll label="Compliance rules">
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              <th className={TH}>Code</th>
              <th className={TH}>Rule</th>
              <th className={TH}>Type</th>
              <th className={TH}>Threshold</th>
              <th className={TH}>Effect</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rules.map((r) => (
              <RuleRow key={r.code + r.thresholdValue + r.behaviour + r.enabled} r={r} isAdmin={isAdmin} onChanged={reload} />
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="mt-3 max-w-[65ch] text-sm text-[var(--muted)]">
        Statutory rules stay on. Fixed rules cannot change.
      </p>
    </>
  );
}
