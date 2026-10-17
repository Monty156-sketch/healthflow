// A person's own notifications. Nobody reads anyone else's.
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { syncReturns } from "../../lib/returns.js";
import { syncCover } from "../../lib/cover.js";
import { caller } from "../../middleware/facilityAccess.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", async (req, res) => {
  const who = caller(req);
  await syncReturns(who.facilityId);
  await syncCover(who.facilityId);
  const mine = { facilityId: who.facilityId, recipientEmail: who.email };
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where: mine, orderBy: { createdAt: "desc" }, take: 60 }),
    prisma.notification.count({ where: { ...mine, read: false } }),
  ]);
  res.json({
    unread,
    notifications: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, linkUrl: n.linkUrl, severity: n.severity, read: n.read, createdAt: n.createdAt.toISOString() })),
  });
});

notificationsRouter.get("/count", async (req, res) => {
  const who = caller(req);
  res.json({ unread: await prisma.notification.count({ where: { facilityId: who.facilityId, recipientEmail: who.email, read: false } }) });
});

notificationsRouter.post("/read-all", async (req, res) => {
  const who = caller(req);
  await prisma.notification.updateMany({ where: { facilityId: who.facilityId, recipientEmail: who.email, read: false }, data: { read: true, readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.post("/:id/read", async (req, res) => {
  const who = caller(req);
  await prisma.notification.updateMany({ where: { id: String(req.params.id), facilityId: who.facilityId, recipientEmail: who.email }, data: { read: true, readAt: new Date() } });
  res.json({ ok: true });
});
