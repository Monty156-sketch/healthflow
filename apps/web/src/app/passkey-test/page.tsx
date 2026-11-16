"use client";

// A test page for fingerprint and Face ID on one phone. It makes throwaway keys on the phone only and sends nothing to HealthFlow.
// It shows which ways of asking the phone work, so the real sign-in can use the one that does.
import { useEffect, useState } from "react";

type Line = { text: string; ok: boolean };
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const toB64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const VARIANTS: { id: string; name: string; sel: AuthenticatorSelectionCriteria; hints?: string[] }[] = [
  { id: "A", name: "A. Current way (key kept in the passkey list)", sel: { residentKey: "required", userVerification: "required" } },
  { id: "B", name: "B. This phone only, not in a list (the one that said cancelled)", sel: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "required" } },
  { id: "C", name: "C. This phone only, list allowed", sel: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" } },
  { id: "D", name: "D. This phone only, key in the list", sel: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" } },
  { id: "E", name: "E. This phone only, unlock preferred not required", sel: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "preferred" } },
  { id: "F", name: "F. Ask for this device with a hint", sel: { residentKey: "preferred", userVerification: "required" }, hints: ["client-device"] },
];

function Variant({ v }: { v: (typeof VARIANTS)[number] }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [id, setId] = useState<string | null>(null);
  const add = (text: string, ok: boolean) => setLines((l) => [...l, { text, ok }]);
  const fail = (what: string, t0: number, e: unknown) => add(`${what}: failed after ${Date.now() - t0} ms. ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`, false);

  async function create() {
    const t0 = Date.now();
    try {
      const pk = {
        rp: { name: "HealthFlow test", id: location.hostname }, challenge: rnd(32),
        user: { id: rnd(16), name: `test-${v.id}@healthflow`, displayName: `Test ${v.id}` },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], timeout: 60_000, attestation: "none", authenticatorSelection: v.sel,
        ...(v.hints ? { hints: v.hints } : {}),
      } as unknown as PublicKeyCredentialCreationOptions;
      const c = (await navigator.credentials.create({ publicKey: pk })) as PublicKeyCredential;
      const tr = (c.response as AuthenticatorAttestationResponse).getTransports?.() ?? [];
      setId(toB64(c.rawId));
      add(`1. Turn on: worked in ${Date.now() - t0} ms. Phone said it is: ${tr.join(", ") || "(did not say)"}. Attachment: ${c.authenticatorAttachment ?? "(not said)"}.`, true);
    } catch (e) { fail("1. Turn on", t0, e); }
  }
  async function signIn(withId: boolean, withTransport: boolean) {
    const t0 = Date.now();
    const label = withId ? (withTransport ? "2. Sign in, key named, this phone" : "3. Sign in, key named") : "4. Sign in, phone chooses";
    try {
      const pk: PublicKeyCredentialRequestOptions = {
        challenge: rnd(32), rpId: location.hostname, userVerification: "required", timeout: 60_000,
        ...(withId && id ? { allowCredentials: [{ type: "public-key", id: fromB64(id), ...(withTransport ? { transports: ["internal"] as AuthenticatorTransport[] } : {}) }] } : {}),
      };
      await navigator.credentials.get({ publicKey: pk });
      add(`${label}: worked in ${Date.now() - t0} ms.`, true);
    } catch (e) { fail(label, t0, e); }
  }
  const btn = "min-h-11 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[15px]";
  return (
    <section className="rounded border border-[var(--border)] p-4">
      <h2 className="mb-2 font-medium">{v.name}</h2>
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={create}>1. Turn on</button>
        <button className={btn} disabled={!id} onClick={() => signIn(true, true)}>2. Sign in (key named, this phone)</button>
        <button className={btn} disabled={!id} onClick={() => signIn(true, false)}>3. Sign in (key named)</button>
        <button className={btn} onClick={() => signIn(false, false)}>4. Sign in (phone chooses)</button>
      </div>
      <ul className="mt-2 space-y-1 text-sm">{lines.map((l, i) => <li key={i} className={l.ok ? "text-[var(--status-success,green)]" : "text-[var(--status-warning,#b54708)]"}>{l.text}</li>)}</ul>
    </section>
  );
}

export default function PasskeyTest() {
  const [info, setInfo] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      const out = [`Browser: ${navigator.userAgent}`, `Address: ${location.hostname}`, `Opened from the home screen: ${window.matchMedia("(display-mode: standalone)").matches ? "yes" : "no"}`];
      try { out.push(`Phone has a fingerprint, face or screen lock ready: ${await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()}`); } catch (e) { out.push(`Lock check failed: ${String(e)}`); }
      setInfo(out);
    })();
  }, []);
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Fingerprint and Face ID test</h1>
      <p className="text-[15px]">This page only tests this phone. It sends nothing to HealthFlow. For each line below, tap 1, unlock when asked, then tap 2, 3 and 4. Then screenshot the whole page and send it.</p>
      <ul className="text-sm text-[var(--muted)]">{info.map((t, i) => <li key={i}>{t}</li>)}</ul>
      {VARIANTS.map((v) => <Variant key={v.id} v={v} />)}
    </main>
  );
}
