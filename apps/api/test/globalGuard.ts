import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Runs once before any test. The suite deletes every row, so it must never meet the live database.
export default function guard() {
  const script = fileURLToPath(new URL("../../../scripts/db-guard.mjs", import.meta.url));
  execFileSync(process.execPath, [script, "test"], { stdio: "inherit" });
  // The enforced run also wipes through the owner connection, so that address must be a test database too.
  const owner = process.env.TEST_OWNER_DATABASE_URL;
  if (owner) execFileSync(process.execPath, [script, "test"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: owner } });
}
