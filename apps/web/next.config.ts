import type { NextConfig } from "next";

// cacheComponents and partialPrefetching are deliberately OFF. They hang on
// Cloudflare's Workers runtime (Next.js warns it cannot guarantee them
// there), and HealthFlow's pages are per-user, signed-in views that gain
// nothing from shared caching.
// The commit this build was made from, shown at the foot of the menu and at
// /version, so anyone can see which version is live.
const build = (process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local").slice(0, 7);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD: build },
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
