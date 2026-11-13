"use client";

// The "Fingerprint or face sign-in" panel on the Security page. Turning it on is done on each device, because each
// phone keeps its own key behind its own lock. Turning it off removes that device.
import { FormEvent, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useResource } from "@/lib/useApi";
import { addPasskey, browserSupportsWebAuthn, passkeyMessage, type PasskeyRow } from "@/lib/passkeys";
import { showDateTime } from "@/lib/format";
import { Button, Field, Input, Loading, Notice, Panel } from "@/components/ui";

const noSubscribe = () => () => undefined;

export function PasskeyPanel() {
  const supported = useSyncExternalStore(noSubscribe, () => browserSupportsWebAuthn(), () => false);
  const { data, error, reload } = useResource<{ passkeys: PasskeyRow[] }>("/api/auth/account/passkeys");
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function turnOn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      await addPasskey(password);
      setPassword("");
      setAdding(false);
      setDone("Done. Next time, choose “Sign in with fingerprint or Face ID” on the sign-in page.");
      reload();
    } catch (err) {
      setProblem(passkeyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(id: string) {
    setProblem(null);
    setDone(null);
    try {
      await api.delete(`/api/auth/account/passkeys/${id}`);
      reload();
    } catch (err) {
      setProblem(passkeyMessage(err));
    }
  }

  return (
    <Panel title="Fingerprint or face sign-in" description="Sign in with the same fingerprint, Face ID or screen lock you use to open this phone. Your fingerprint or face never leaves the phone.">
      {!supported ? (
        <Notice tone="warning">This browser cannot do fingerprint or face sign-in. Try Chrome or Safari on a phone or computer with a fingerprint, face or screen lock set up.</Notice>
      ) : error && !data ? (
        <Notice tone="block">Could not load this. Check your connection and reload.</Notice>
      ) : !data ? (
        <Loading label="Loading" />
      ) : (
        <div className="space-y-4">
          {data.passkeys.length > 0 ? (
            <ul className="divide-y divide-[var(--border)]">
              {data.passkeys.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                  <span>
                    <span className="font-medium">{p.deviceName}</span>
                    <span className="block text-sm text-[var(--muted)]">
                      Turned on {showDateTime(p.createdAt)}
                      {p.lastUsedAt ? `, last used ${showDateTime(p.lastUsedAt)}` : ", not used yet"}
                    </span>
                  </span>
                  <Button variant="secondary" onClick={() => turnOff(p.id)}>Turn off</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-[var(--muted)]">Not turned on yet.</p>
          )}
          {done && <Notice tone="success">{done}</Notice>}
          {problem && <Notice tone="block">{problem}</Notice>}
          {adding ? (
            <form onSubmit={turnOn} className="max-w-sm space-y-3">
              <Field label="Your password" hint="We ask again so nobody else can turn this on for your account.">
                {(a) => <Input {...a} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !password}>{busy ? "Waiting for your phone…" : "Turn on for this device"}</Button>
                <Button type="button" variant="secondary" onClick={() => { setAdding(false); setProblem(null); }}>Cancel</Button>
              </div>
            </form>
          ) : (
            <Button onClick={() => { setAdding(true); setDone(null); }}>{data.passkeys.length ? "Turn on for another device" : "Turn on for this device"}</Button>
          )}
        </div>
      )}
    </Panel>
  );
}
