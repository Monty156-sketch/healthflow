import type { MetadataRoute } from "next";

/** Lets a nurse add HealthFlow to her phone's home screen and open it like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HealthFlow",
    short_name: "HealthFlow",
    description: "Your duty roster, leave and swaps.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#eef2ef",
    theme_color: "#0a2f2c",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
