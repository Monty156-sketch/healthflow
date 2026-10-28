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
import net from "node:net";
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

/**
 * One person usually holds a whole /64 of IPv6 addresses and can send each request from a new one,
 * so for rate limiting an IPv6 address is reduced to its /64. IPv4 (and IPv4 inside IPv6) is kept as is.
 */
export function limitKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (net.isIPv6(ip)) {
    const [head, tail = ""] = ip.split("::");
    const groups = head ? head.split(":") : [];
    // Fill the compressed middle so the first four groups are the real prefix.
    const missing = 8 - groups.length - (tail ? tail.split(":").length : 0);
    const full = [...groups, ...Array(ip.includes("::") ? Math.max(missing, 0) : 0).fill("0"), ...(tail ? tail.split(":") : [])];
    return full.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
  }
  return ip;
}

export function clientIp(req: Request): string {
  const forwarded = req.get(CLIENT_IP_HEADER);
  if (forwarded && secretMatches(req.get(SECRET_HEADER))) {
    return forwarded.trim();
  }
  return req.ip ?? "unknown";
}

/** The key rate limiters count by. */
export function rateKey(req: Request): string {
  return limitKey(clientIp(req));
}
