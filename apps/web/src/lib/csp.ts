// The Content Security Policy, with a fresh nonce for every page view.
//
// Pages are built ahead of time, so Next.js cannot put a nonce in them. The
// Worker does it instead: it makes a nonce, adds it to every <script> tag as
// the page streams past, and sends a policy that allows only scripts carrying
// that nonce (and scripts those scripts load, through 'strict-dynamic').
// An injected <script> or an inline handler has no nonce and does not run.
//
// Style elements are held to the same nonce. Only style attributes stay open:
// React sets them on elements, and an attribute cannot carry a nonce. They
// cannot run code or load anything from elsewhere.

interface Rewriter {
  on(selector: string, handlers: { element(el: { setAttribute(name: string, value: string): void }): void }): Rewriter;
  transform(response: Response): Response;
}
declare const HTMLRewriter: new () => Rewriter;

export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function policyFor(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "media-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Adds the nonce to a page's scripts and the policy to its headers. Other responses pass through. */
export function withScriptPolicy(response: Response): Response {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return response;
  const nonce = makeNonce();
  const rewritten = new HTMLRewriter()
    .on("script", { element: (el) => el.setAttribute("nonce", nonce) })
    .on("style", { element: (el) => el.setAttribute("nonce", nonce) })
    // A script that is preloaded is held to the same policy as one that runs.
    .on('link[rel="preload"][as="script"], link[rel="modulepreload"]', { element: (el) => el.setAttribute("nonce", nonce) })
    .transform(response);
  const out = new Response(rewritten.body, rewritten);
  out.headers.set("Content-Security-Policy", policyFor(nonce));
  out.headers.delete("content-length");
  return out;
}
