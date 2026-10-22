// What state the signed-in person's facility is in, open to every role and to a
// locked facility, so the app can show the right screen: a payment reminder, the
// bills page, or a plain "waiting for approval".
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { accessEnds, daysUntil, REMIND_DAYS } from "../../lib/access.js";
import { caller } from "../../middleware/facilityAccess.js";

export const accessRouter = Router();

accessRouter.get("/", async (req, res) => {
  const who = caller(req);
  const f = await prisma.facility.findUniqueOrThrow({
    where: { id: who.facilityId },
    select: { status: true, accessNote: true, trialEndsAt: true, subscription: { select: { status: true, billingCycle: true, currentPeriodEnd: true, trialEndsAt: true } } },
  });
  const canPay = who.role === "FACILITY_ADMIN";
  const end = accessEnds(f, f.subscription);
  const days = end ? daysUntil(end) : null;
  const locked = f.status === "PENDING" || f.status === "DECLINED" || f.status === "LAPSED" || f.status === "SUSPENDED";
  const knowsOfBilling = ["FACILITY_ADMIN", "ROSTER_MANAGER", "SUPERVISOR"].includes(who.role);
  res.json({
    status: f.status,
    locked,
    canPay,
    note: f.accessNote,
    endsOn: end ? end.toISOString().slice(0, 10) : null,
    kind: f.status === "TRIAL" ? "trial" : "subscription",
    daysLeft: days,
    reminder: !locked && f.status !== "SUSPENDED" && knowsOfBilling && days !== null && days <= REMIND_DAYS && days > 0,
  });
});
