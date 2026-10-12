import type { NextConfig } from "next";

// cacheComponents and partialPrefetching are deliberately OFF. They hang on
// Cloudflare's Workers runtime (Next.js warns it cannot guarantee them
// there), and HealthFlow's pages are per-user, signed-in views that gain
// nothing from shared caching.
const nextConfig: NextConfig = {
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
