// OpenNext adapter config: turns the Next.js build into a Cloudflare Worker.
// No incremental cache bucket: HealthFlow's pages are signed-in, per-user
// views that are not cached between visitors anyway.
// Reference: https://opennext.js.org/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
