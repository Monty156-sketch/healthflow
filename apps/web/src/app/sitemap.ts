import type { MetadataRoute } from "next";

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://healthflow.example").replace(/\/+$/, "");
const PATHS = ["", "/pricing", "/security", "/about", "/help", "/status", "/changelog", "/contact", "/register", "/terms", "/privacy", "/dpa"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((p) => ({ url: `${BASE}${p}`, changeFrequency: p === "" ? "weekly" : "monthly" }));
}
