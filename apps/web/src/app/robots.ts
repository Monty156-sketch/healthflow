import type { MetadataRoute } from "next";

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://healthflow.example").replace(/\/+$/, "");

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/platform", "/district"] }], sitemap: `${BASE}/sitemap.xml` };
}
