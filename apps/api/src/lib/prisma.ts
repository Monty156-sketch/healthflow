import { PrismaClient } from "@healthflow/db";

// One client per process, reused across requests — Render's free tier
// sleeps between requests, so a fresh client on every cold start is
// expected and fine; this just avoids creating one per request while warm.
export const prisma = new PrismaClient();
