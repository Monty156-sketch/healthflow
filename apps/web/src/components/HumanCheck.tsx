"use client";

// Cloudflare's "verify you are human" box. Shown only to staff, and only once the server asks for it.
import { useEffect, useRef } from "react";

interface TurnstileApi {
  render: (el: HTMLElement, options: { sitekey: string; callback: (t: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
  remove: (id: string) => void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function whenReady(run: () => void): () => void {
  if (window.turnstile) { run(); return () => undefined; }
  let script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
  if (!script) {
    script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    document.head.appendChild(script);
  }
  const go = () => run();
  script.addEventListener("load", go);
  return () => script?.removeEventListener("load", go);
}

export function HumanCheck({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  useEffect(() => { cb.current = onToken; });
  useEffect(() => {
    let id: string | null = null;
    const stop = whenReady(() => {
      if (!box.current || !window.turnstile || id) return;
      id = window.turnstile.render(box.current, { sitekey: siteKey, callback: (t) => cb.current(t), "expired-callback": () => cb.current(null), "error-callback": () => cb.current(null) });
    });
    return () => { stop(); if (id && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey]);
  return <div ref={box} aria-label="Verify you are human" className="min-h-[65px]" />;
}
