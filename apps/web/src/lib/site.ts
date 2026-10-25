// The public address of the site, used for canonical links, the sitemap and
// social previews. Set NEXT_PUBLIC_SITE_URL when the build is made once the
// final address (a custom domain, say) is chosen.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://healthflow.muslimfroko05.workers.dev").replace(/\/+$/, "");
export const SITE_NAME = "HealthFlow";
export const SITE_DESCRIPTION =
  "HealthFlow builds the monthly duty roster for Ghana Health Service and CHAG health facilities from their own shifts and rules, checks it against Ghana's Labour Act before it is published, and prints the A4 sheet staff already recognise.";
