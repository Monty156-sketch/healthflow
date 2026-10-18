// The Worker entry. Cloudflare's free plan allows about 10 ms of CPU per
// request, and starting the Next.js server inside a fresh Worker costs more
// than that. Every API call (sign-in, session refresh, data) would pay that
// price for no reason, so /api/* is answered here by a plain forward to the
// API and Next.js is loaded only for pages. That is the "Worker exceeded
// resource limits" (error 1102) fix.
import openNext from "./.open-next/worker.js";
import { forwardToApi } from "./src/lib/apiProxy.ts";

export * from "./.open-next/worker.js";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return forwardToApi(request, env.API_ORIGIN ?? "", env.PROXY_SHARED_SECRET);
    }
    return openNext.fetch(request, env, ctx);
  },
};
