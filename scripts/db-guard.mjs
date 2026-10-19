#!/usr/bin/env node
// Refuses to run something destructive against the live database.
//
//   node scripts/db-guard.mjs test      before the test suite (it wipes every table)
//   node scripts/db-guard.mjs develop   before `migrate dev`, seeding or the dev server
//
// DATABASE_URL comes from the environment or from the .env file in the
// current folder. A database on this computer is always fine. A hosted one is
// fine only if it says it is a test database (its name contains "test") or the
// person has said it is a staging copy with HEALTHFLOW_DB_ROLE=staging.
// Production deploys run `migrate deploy`, which this guard never touches.
import { readFileSync } from "node:fs";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);

export function judge(url, purpose, role = "") {
  if (!url) return { ok: false, why: "DATABASE_URL is not set." };
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, why: "DATABASE_URL is not a valid address." };
  }
  const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (LOCAL.has(u.hostname)) return { ok: true };
  if (purpose === "test") {
    return /test/i.test(name) ? { ok: true } : { ok: false, why: `The tests delete every row in the database, and "${name}" on ${u.hostname} is not a test database (its name must contain "test").` };
  }
  return role === "staging" ? { ok: true } : { ok: false, why: `"${name}" on ${u.hostname} is not on this computer. If it is the staging copy, set HEALTHFLOW_DB_ROLE=staging. If it is the live database, do not run this.` };
}

function fromDotenv() {
  try {
    const m = /^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(readFileSync(".env", "utf8"));
    return m?.[1];
  } catch {
    return undefined;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const purpose = process.argv[2] === "test" ? "test" : "develop";
  const verdict = judge(process.env.DATABASE_URL ?? fromDotenv(), purpose, process.env.HEALTHFLOW_DB_ROLE);
  if (!verdict.ok) {
    console.error(`\nStopped: ${verdict.why}\nSee RUNBOOK.md, "Staging and safe databases".\n`);
    process.exit(1);
  }
}
