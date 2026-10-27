// Removes one facility and everything that belongs to it, in one transaction,
// so it can register again from nothing. It follows the database's own
// foreign keys, so a table added later is covered without editing this file.
// Rows that merely mention the facility (error reports) keep their row and
// lose the link. Anything that cannot be removed cleanly rolls the whole
// thing back and leaves the data as it was.
import type { Prisma } from "@healthflow/db";
import { prisma } from "./prisma.js";

interface Fk { child: string; childCol: string; parent: string; parentCol: string; nullable: boolean }

const KEEP_ROWS = new Set(["ErrorReport"]); // set the link to null instead of deleting

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function foreignKeys(tx: Prisma.TransactionClient): Promise<Fk[]> {
  return tx.$queryRawUnsafe<Fk[]>(`
    SELECT cl.relname AS child, a.attname AS "childCol", pl.relname AS parent, af.attname AS "parentCol", NOT a.attnotnull AS nullable
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_class pl ON pl.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1`);
}

export interface PurgeReport { facility: string; rows: Record<string, number> }

/**
 * Deletes the facility called `name`. With dryRun it does everything, counts
 * what was removed, then rolls back, so the counts are exact.
 */
export async function purgeFacility(name: string, opts: { dryRun: boolean }): Promise<PurgeReport> {
  const rows: Record<string, number> = {};
  class DryRun extends Error {}
  try {
    await prisma.$transaction(
      async (tx) => {
        const found = await tx.facility.findMany({ where: { name }, select: { id: true } });
        if (found.length !== 1) throw new Error(found.length === 0 ? `No facility is named "${name}".` : `${found.length} facilities are named "${name}". Rename one first.`);
        const fks = await foreignKeys(tx);
        const add = (t: string, n: number) => { if (n) rows[t] = (rows[t] ?? 0) + n; };

        // Remove rows of `table` matching `where`, children first.
        const remove = async (table: string, where: string, params: unknown[], stack: string[]) => {
          for (const fk of fks.filter((f) => f.parent === table)) {
            const sub = `${q(fk.childCol)} IN (SELECT ${q(fk.parentCol)} FROM ${q(table)} WHERE ${where})`;
            if (fk.child === table || stack.includes(fk.child)) {
              // Points back up the chain (a manager, a photo consent): detach it, the row is deleted from above.
              if (fk.nullable) await tx.$executeRawUnsafe(`UPDATE ${q(fk.child)} SET ${q(fk.childCol)} = NULL WHERE ${sub}`, ...params);
              continue;
            }
            if (KEEP_ROWS.has(fk.child)) {
              await tx.$executeRawUnsafe(`UPDATE ${q(fk.child)} SET ${q(fk.childCol)} = NULL WHERE ${sub}`, ...params);
              continue;
            }
            await remove(fk.child, sub, params, [...stack, table]);
          }
          add(table, await tx.$executeRawUnsafe(`DELETE FROM ${q(table)} WHERE ${where}`, ...params));
        };

        await remove("Facility", `"id" = $1`, [found[0].id], []);

        // Tables that record the facility's id without a foreign key to it.
        const loose = await tx.$queryRawUnsafe<{ table_name: string }[]>(
          `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'facilityId' AND table_name <> 'Facility'`,
        );
        for (const { table_name } of loose) {
          add(table_name, await tx.$executeRawUnsafe(`DELETE FROM ${q(table_name)} WHERE "facilityId" = $1`, found[0].id));
        }
        if (opts.dryRun) throw new DryRun();
      },
      { timeout: 900_000, maxWait: 30_000 },
    );
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return { facility: name, rows };
}
