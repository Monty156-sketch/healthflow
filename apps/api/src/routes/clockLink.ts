// The automatic link: a small program on the hospital PC reads new punches from ZKBio Time and sends them here.
// It signs in with a key made on the Clock devices page, not with a person's login.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { inFacilityRun } from "../lib/tenant.js";
import { hashKey } from "../lib/clockLink.js";
import { punchFrom } from "../lib/clockImport.js";
import { runPunchImport } from "../lib/clockPipeline.js";
import { parseOr400 } from "../lib/validate.js";

export const clockLinkRouter = Router();

const input = z.object({
  punches: z.array(z.object({ code: z.string().max(30), time: z.string().max(30), state: z.string().max(30), name: z.string().max(120).optional(), dept: z.string().max(80).optional() })).min(1).max(600),
});

clockLinkRouter.post("/punches", async (req, res) => {
  const m = /^Bearer (hfk_[A-Za-z0-9_-]{20,})$/.exec(req.get("authorization") ?? "");
  if (!m) return res.status(401).json({ error: "unauthorised", message: "Missing or invalid key." });
  const device = await prisma.clockDevice.findFirst({ where: { apiKeyHash: hashKey(m[1]), active: true }, select: { id: true, name: true, facilityId: true } });
  if (!device) return res.status(401).json({ error: "unauthorised", message: "Missing or invalid key." });
  const body = parseOr400(input, req.body, res);
  if (!body) return;
  let skipped = 0;
  const punches = body.punches.flatMap((p) => {
    const x = punchFrom(p.code, p.time, p.state, p.name, p.dept);
    if (!x) skipped++;
    return x ? [x] : [];
  });
  if (!punches.length) return res.json({ ok: true, received: 0, skipped, newAttendance: 0 });
  const out = await inFacilityRun(device.facilityId, async () => {
    const r = await runPunchImport({ facilityId: device.facilityId, device, punches, skipped, apply: true, audit: false, actor: "ZKBio Time link", actorEmail: "clock-link" });
    await prisma.clockDevice.update({ where: { id: device.id }, data: { lastPushAt: new Date(), lastPushCount: punches.length } });
    return r;
  });
  res.json({ ok: true, received: punches.length, skipped, newAttendance: out.summary.attendanceNew, departuresAdded: out.summary.departuresAdded });
});
