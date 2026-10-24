import type { NextConfig } from "next";

// cacheComponents and partialPrefetching are deliberately OFF. They hang on
// Cloudflare's Workers runtime (Next.js warns it cannot guarantee them
// there), and HealthFlow's pages are per-user, signed-in views that gain
// nothing from shared caching.
// The commit this build was made from, shown at the foot of the menu and at
// /version, so anyone can see which version is live.
const build = (process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local").slice(0, 7);

// Headers every page carries. The script and style sources are not locked down
// here: Next.js writes inline scripts that would need a per-request nonce, which
// is a separate piece of work. What is locked is who may frame the site, where
// forms may post, what a base tag may point to, and how the browser treats
// types, referrers and the camera, microphone and location.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
];

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD: build },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
