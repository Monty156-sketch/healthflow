// The real client IP, for rate limiting and session records.
//
// In production the browser never calls this API directly: the frontend
// forwards /api/* requests from its own domain (so the session cookie is
// first-party). That means every request reaches us from Cloudflare's
// network, and req.ip would be the same few addresses for every user. One
// person's failed logins would then lock everyone out.
//
// The frontend proxy sends the visitor's IP in X-HF-Client-IP, together with
// a shared secret. The header is trusted ONLY when the secret matches, so
// nobody can call the API directly and pretend to be another IP.
import crypto from "node:crypto";
import type { Request } from "express";

const SECRET_HEADER = "x-hf-proxy-secret";
const CLIENT_IP_HEADER = "x-hf-client-ip";

function secretMatches(provided: string | undefined): boolean {
  const expected = process.env.PROXY_SHARED_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function clientIp(req: Request): string {
  const forwarded = req.get(CLIENT_IP_HEADER);
  if (forwarded && secretMatches(req.get(SECRET_HEADER))) {
    return forwarded.trim();
  }
  return req.ip ?? "unknown";
}
