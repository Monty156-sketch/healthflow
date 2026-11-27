// The Worker entry. Cloudflare's free plan allows about 10 ms of CPU per
// request, and starting the Next.js server inside a fresh Worker costs more
// than that. Every API call (sign-in, session refresh, data) would pay that
// price for no reason, so /api/* is answered here by a plain forward to the
// API and Next.js is loaded only for pages. That is the "Worker exceeded
// resource limits" (error 1102) fix.
import openNext from "./.open-next/worker.js";
import { forwardToApi } from "./src/lib/apiProxy.ts";
import { withScriptPolicy } from "./src/lib/csp.ts";

export * from "./.open-next/worker.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    // A clocking machine (ZKTeco, "ADMS") calls /iclock/... and many cannot use https. Only those calls are answered over plain http;
    // every other address, the API and the sign-in page included, is sent to https first so no password ever travels in the clear.
    if (pathname.startsWith("/iclock/")) {
      return forwardToApi(request, env.API_ORIGIN ?? "", env.PROXY_SHARED_SECRET, "/api");
    }
    if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return forwardToApi(request, env.API_ORIGIN ?? "", env.PROXY_SHARED_SECRET);
    }
    // Pages get a policy that allows only scripts carrying this view's nonce.
    return withScriptPolicy(await openNext.fetch(request, env, ctx));
  },

  // Runs every 5 minutes from Cloudflare's own clock (see "triggers" in wrangler.jsonc) so the API on Render's free
  // plan never goes to sleep. GitHub's schedule was running only every few hours.
  async scheduled(_event, env, ctx) {
    const origin = (env.API_ORIGIN ?? "").replace(/\/+$/, "");
    if (origin) ctx.waitUntil(fetch(`${origin}/health`).then((r) => r.arrayBuffer()).catch(() => undefined));
  },
};
