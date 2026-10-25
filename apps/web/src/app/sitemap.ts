import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const PATHS: [string, number][] = [["", 1], ["/register", 0.9], ["/district/register", 0.7], ["/pricing", 0.8], ["/security", 0.6], ["/about", 0.6], ["/help", 0.6], ["/contact", 0.5], ["/status", 0.3], ["/changelog", 0.3], ["/terms", 0.2], ["/privacy", 0.2], ["/dpa", 0.2]];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PATHS.map(([p, priority]) => ({ url: `${SITE_URL}${p}`, lastModified: now, changeFrequency: p === "" ? "weekly" : "monthly", priority }));
}
