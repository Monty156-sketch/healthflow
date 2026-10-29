// What users tell PS Tech, in one place: a summary, every comment, and a status so nothing is missed.
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@healthflow/db";
import { prisma } from "../lib/prisma.js";
import { parseOr400 } from "../lib/validate.js";
import { platformAudit } from "../lib/platformAudit.js";
import { FEEDBACK_CATEGORIES } from "./facility/feedback.js";

export const feedbackConsole = Router();

const DAY = 86_400_000;

const listQuery = z.object({
  status: z.enum(["NEW", "READ", "ACTIONED"]).optional(),
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  facilityId: z.string().optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
});

feedbackConsole.get("/feedback", async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "invalid_input" });
  const where: Prisma.FeedbackWhereInput = {
    ...(q.data.status ? { status: q.data.status } : {}),
    ...(q.data.category ? { category: q.data.category } : {}),
    ...(q.data.rating ? { rating: q.data.rating } : {}),
    ...(q.data.facilityId ? { facilityId: q.data.facilityId } : {}),
    ...(q.data.days ? { createdAt: { gte: new Date(Date.now() - q.data.days * DAY) } } : {}),
  };
  const [rows, all, byRating, newCount] = await Promise.all([
    prisma.feedback.findMany({
      where, orderBy: { createdAt: "desc" }, take: 300,
      include: { facility: { select: { name: true } }, user: { select: { userEmail: true } } },
    }),
    prisma.feedback.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
    prisma.feedback.groupBy({ by: ["rating"], where, _count: { _all: true } }),
    prisma.feedback.count({ where: { status: "NEW" } }),
  ]);
  const counts: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const g of byRating) counts[String(g.rating)] = g._count._all;
  res.json({
    summary: { total: all._count._all, average: all._avg.rating === null ? null : Math.round(all._avg.rating * 10) / 10, byRating: counts, unread: newCount },
    feedback: rows.map((r) => ({
      id: r.id, createdAt: r.createdAt, facilityId: r.facilityId, facility: r.facility.name, from: r.user.userEmail, role: r.role,
      rating: r.rating, category: r.category, message: r.message, screen: r.screen, asked: r.asked, status: r.status, note: r.note,
    })),
  });
});

const patchInput = z.object({ status: z.enum(["NEW", "READ", "ACTIONED"]).optional(), note: z.string().trim().max(1000).optional() });

feedbackConsole.patch("/feedback/:id", async (req, res) => {
  const body = parseOr400(patchInput, req.body, res);
  if (!body) return;
  const row = await prisma.feedback.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
  if (!row) return res.status(404).json({ error: "not_found" });
  await prisma.feedback.update({ where: { id: row.id }, data: { ...(body.status ? { status: body.status } : {}), ...(body.note !== undefined ? { note: body.note || null } : {}) } });
  await platformAudit(req, "feedback_reviewed", `Marked feedback ${body.status ? body.status.toLowerCase() : "with a note"}.`, { entityType: "Feedback", entityId: row.id }).catch(() => undefined);
  res.json({ ok: true });
});
