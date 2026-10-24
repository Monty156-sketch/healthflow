// Deletes one facility and all its data so it can register fresh.
//
//   pnpm --filter @healthflow/api exec tsx scripts/purge-facility.ts "Sombo Health Centre"
//       shows what would be deleted and changes nothing.
//   pnpm --filter @healthflow/api exec tsx scripts/purge-facility.ts "Sombo Health Centre" --yes
//       deletes it. This cannot be undone: take a backup first.
//
// Run it with DATABASE_URL pointing at the database you mean. It prints the
// database host first so a wrong target is obvious before anything is deleted.
import { purgeFacility } from "../src/lib/purgeFacility.js";
import { prisma } from "../src/lib/prisma.js";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const yes = args.includes("--yes");
if (!name) {
  console.error('Usage: tsx scripts/purge-facility.ts "Facility name" [--yes]');
  process.exit(1);
}
const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").host; } catch { return "(DATABASE_URL not set)"; } })();
console.log(`Database: ${host}`);
purgeFacility(name, { dryRun: !yes })
  .then((r) => {
    const total = Object.values(r.rows).reduce((a, b) => a + b, 0);
    for (const [t, n] of Object.entries(r.rows).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(7)}  ${t}`);
    console.log(yes ? `Deleted ${total} rows for "${r.facility}".` : `Dry run: ${total} rows would be deleted for "${r.facility}". Add --yes to delete them.`);
  })
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
