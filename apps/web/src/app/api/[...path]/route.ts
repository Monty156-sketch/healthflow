// Local development path for /api/*. On Cloudflare the Worker entry
// (worker.mjs) answers these requests before Next.js is even loaded, which
// keeps each API call well inside the free plan's CPU limit.
import { forwardToApi } from "@/lib/apiProxy";

const forward = (request: Request) => forwardToApi(request, process.env.API_ORIGIN ?? "http://localhost:4000", process.env.PROXY_SHARED_SECRET);

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
export const OPTIONS = forward;
