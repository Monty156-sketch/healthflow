import { PrismaClient } from "@healthflow/db";
import { rlsEnforced, settingsFor, tenantContext } from "./tenant.js";

const base = new PrismaClient();

// With RLS_ENFORCE=on, every query first tells Postgres which facility it is for, in the same
// transaction, so the row-level security policies can refuse other facilities' rows.
// With it off (the default) this is the plain client, exactly as before.
function enforced(): PrismaClient {
  const setContext = () => {
    const s = settingsFor(tenantContext.getStore());
    return base.$executeRaw`SELECT set_config('app.facility_id', ${s.facilityId}, true), set_config('app.bypass_rls', ${s.bypass}, true)`;
  };

  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await base.$transaction([setContext(), query(args)]);
          return result;
        },
      },
    },
  });

  return new Proxy(extended, {
    get(target, prop) {
      if (prop === "$transaction") {
        return (arg: unknown, options?: unknown) => {
          if (typeof arg !== "function") {
            throw new Error("Use prisma.$transaction(async (tx) => ...) so row-level security applies to every statement.");
          }
          // The callback's client is the plain one, so it does not wrap each statement again.
          return base.$transaction(async (tx) => {
            const s = settingsFor(tenantContext.getStore());
            await tx.$executeRaw`SELECT set_config('app.facility_id', ${s.facilityId}, true), set_config('app.bypass_rls', ${s.bypass}, true)`;
            return (arg as (t: typeof tx) => Promise<unknown>)(tx);
          }, options as never);
        };
      }
      if (prop === "$queryRaw" || prop === "$queryRawUnsafe" || prop === "$executeRaw" || prop === "$executeRawUnsafe") {
        // Raw SQL runs in its own transaction with the same facility settings, so the policies apply to it too.
        return (...args: unknown[]) =>
          base.$transaction(async (tx) => {
            const s = settingsFor(tenantContext.getStore());
            await tx.$executeRaw`SELECT set_config('app.facility_id', ${s.facilityId}, true), set_config('app.bypass_rls', ${s.bypass}, true)`;
            return (tx as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args);
          });
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as PrismaClient;
}

// One client per process, reused across requests.
export const prisma: PrismaClient = rlsEnforced() ? enforced() : base;
