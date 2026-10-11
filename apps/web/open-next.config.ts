// Config for @opennextjs/cloudflare — translates the Next.js build into
// what Cloudflare Pages' Workers runtime can run (Cloudflare isn't plain
// Node.js, so a normal `next build` output can't be deployed there as-is).
// Docs: https://opennext.js.org/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
