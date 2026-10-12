// The facility's audit log, read-only. There is no route that edits or
// deletes an entry, for any role (Part 3, 0.4).
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@healthflow/db";
import { prisma } from "../../lib/prisma.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";

export const auditRouter = Router();

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.")
  .optional();

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
  q: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(40).optional(),
  from: dateParam,
  to: dateParam,
});

auditRouter.get("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const { facilityId } = caller(req);
  const params = parseOr400(query, req.query, res);
  if (!params) return;

  const createdAt: Prisma.DateTimeFilter = {};
  if (params.from) createdAt.gte = new Date(`${params.from}T00:00:00.000Z`);
  if (params.to) {
    const end = new Date(`${params.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    createdAt.lt = end;
  }

  const where: Prisma.AuditLogWhereInput = {
    facilityId,
    ...(params.entityType ? { entityType: params.entityType } : {}),
    ...(params.from || params.to ? { createdAt } : {}),
    ...(params.q
      ? {
          OR: [
            { summary: { contains: params.q, mode: "insensitive" } },
            { actorEmail: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: { id: true, createdAt: true, actorEmail: true, action: true, entityType: true, summary: true },
    }),
  ]);

  res.json({ entries, total, page: params.page, pageSize: params.pageSize });
});
