// The roster approval chain and the two views that go with it: the queue of
// rosters waiting for the caller, and every ward with its people.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES, READ_ROLES } from "../../middleware/facilityAccess.js";
import { approvalModeOf } from "../../lib/approvalMode.js";

export const approvalsRouter = Router();

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** What each person at the facility is waiting on, by their title. */
const WAITING_FOR: Record<string, string[]> = {
  NURSING_MANAGER: ["UNDER_REVIEW"],
  FACILITY_ADMIN: ["WITH_ADMINISTRATOR"],
  MEDICAL_SUPERINTENDENT: ["WITH_SUPERINTENDENT"],
};

approvalsRouter.get("/", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId, position } = caller(req);
  const state = await approvalModeOf(facilityId);
  const [holders, rosters] = await Promise.all([
    prisma.userProfile.findMany({
      where: { facilityId, active: true, role: { in: ["NURSING_MANAGER", "MEDICAL_SUPERINTENDENT"] } },
      select: { role: true, userEmail: true, staff: { select: { fullName: true } } },
    }),
    prisma.roster.findMany({
      where: { facilityId, status: { in: state.mode === "nursing_manager" ? ["UNDER_REVIEW", "APPROVED", "WITH_ADMINISTRATOR", "WITH_SUPERINTENDENT"] : ["UNDER_REVIEW", "WITH_ADMINISTRATOR", "WITH_SUPERINTENDENT"] } },
      include: { department: { select: { name: true } } },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    }),
  ]);
  const waiting = state.mode === "nursing_manager" ? { ...WAITING_FOR, FACILITY_ADMIN: ["APPROVED", "WITH_ADMINISTRATOR", "WITH_SUPERINTENDENT"] } : WAITING_FOR;
  const mine = waiting[position] ?? [];
  const row = (r: (typeof rosters)[number]) => ({
    id: r.id, label: `${MONTHS[r.month - 1]} ${r.year}`, ward: r.department?.name ?? null, status: r.status, returnNote: r.returnNote, returnedBy: r.returnedBy,
  });
  res.json({
    eligible: state.eligible,
    mode: state.mode,
    enabled: state.switchedOn,
    nursingManager: holders.filter((h) => h.role === "NURSING_MANAGER").map((h) => h.staff?.fullName ?? h.userEmail),
    medicalSuperintendent: holders.filter((h) => h.role === "MEDICAL_SUPERINTENDENT").map((h) => h.staff?.fullName ?? h.userEmail),
    waitingForYou: rosters.filter((r) => mine.includes(r.status)).map(row),
    inProgress: rosters.filter((r) => !mine.includes(r.status)).map(row),
  });
});

approvalsRouter.put("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const input = parseOr400(z.object({ enabled: z.boolean() }), req.body, res);
  if (!input) return;
  const state = await approvalModeOf(who.facilityId);
  if (!state.eligible) return res.status(409).json({ error: "not_available", message: "Only hospitals, polyclinics and teaching hospitals have a nursing manager and a medical superintendent." });
  if (input.enabled) {
    const [nm, ms, approved] = await Promise.all([
      prisma.userProfile.count({ where: { facilityId: who.facilityId, active: true, role: "NURSING_MANAGER" } }),
      prisma.userProfile.count({ where: { facilityId: who.facilityId, active: true, role: "MEDICAL_SUPERINTENDENT" } }),
      prisma.roster.count({ where: { facilityId: who.facilityId, status: "APPROVED" } }),
    ]);
    if (!nm || !ms) return res.status(409).json({ error: "people_missing", message: "Invite a nursing manager and a medical superintendent first. They must both have accounts before rosters can go through them." });
    if (approved) return res.status(409).json({ error: "rosters_waiting", message: "Some rosters are approved and waiting to be published. Publish them first, then switch this on." });
  } else {
    const moving = await prisma.roster.count({ where: { facilityId: who.facilityId, status: { in: ["WITH_ADMINISTRATOR", "WITH_SUPERINTENDENT"] } } });
    if (moving) return res.status(409).json({ error: "rosters_moving", message: "Some rosters are with the administrator or the medical superintendent. Finish or return them first, then switch this off." });
  }
  await prisma.facility.update({ where: { id: who.facilityId }, data: { rosterApprovalChain: input.enabled } });
  await writeAuditLog({
    facilityId: who.facilityId, actorEmail: who.email, action: "roster_chain_changed", entityType: "Facility", entityId: who.facilityId,
    summary: `${who.displayName} ${input.enabled ? "switched on" : "switched off"} the roster approval chain.`,
  });
  res.json({ enabled: input.enabled });
});

/** Every ward with its in-charge and its people. Read only. */
approvalsRouter.get("/wards", allowRoles(...READ_ROLES), async (req, res) => {
  const { facilityId, departmentId } = caller(req);
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const [departments, staff, charges, rosters] = await Promise.all([
    prisma.department.findMany({ where: { facilityId, active: true, ...(departmentId ? { id: departmentId } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
    prisma.staff.findMany({
      where: { facilityId, status: { in: ["ACTIVE", "ON_LEAVE", "PENDING"] } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, status: true, departmentId: true, cadre: { select: { name: true } } },
    }),
    prisma.userProfile.findMany({ where: { facilityId, active: true, role: { in: ["ROSTER_MANAGER", "SUPERVISOR"] }, departmentId: { not: null } }, select: { departmentId: true, staffId: true } }),
    prisma.roster.findMany({ where: { facilityId, month, year }, select: { departmentId: true, status: true, id: true } }),
  ]);
  const inChargeIds = new Set(charges.map((c) => c.staffId));
  const wards = departments.map((d) => {
    const people = staff.filter((s) => s.departmentId === d.id);
    const r = rosters.find((x) => x.departmentId === d.id);
    return {
      id: d.id, name: d.name, kind: d.kind, rosterId: r?.id ?? null, rosterStatus: r?.status ?? null,
      inCharge: people.filter((p) => inChargeIds.has(p.id)).map((p) => p.fullName),
      people: people.map((p) => ({ id: p.id, name: p.fullName, cadre: p.cadre?.name ?? null, status: p.status })),
    };
  });
  res.json({ month, year, wards, unassigned: departmentId ? 0 : staff.filter((s) => !s.departmentId).length });
});
