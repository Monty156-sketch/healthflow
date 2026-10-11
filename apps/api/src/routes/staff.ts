// Minimal for Phase 0: just enough to prove the spec's flagship security
// test end to end — "a staff member set to Transferred cannot sign in, and
// their session ends immediately." The full staff CRUD, invitations and
// self-registration flow belongs to Phase 1 (Wave 0) and Phase 7 (Part 6).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, requireFacilityScope } from "../middleware/auth.js";
import { revokeAllSessionsForUser } from "../lib/tokens.js";
import { writeAuditLog } from "../lib/audit.js";

export const staffRouter = Router();

const deactivationStatuses = ["INACTIVE", "TRANSFERRED", "RESIGNED", "RETIRED"] as const;
const deactivateSchema = z.object({ status: z.enum(deactivationStatuses) });

staffRouter.patch(
  "/:staffId/status",
  requireAuth,
  requireRole("FACILITY_ADMIN", "PLATFORM_ADMIN"),
  requireFacilityScope((req) => req.body?.facilityId),
  async (req, res) => {
    const parsed = deactivateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_body" });

    const staff = await prisma.staff.findUnique({
      where: { id: req.params.staffId },
      include: { userProfile: true },
    });
    if (!staff) return res.status(404).json({ error: "not_found" });

    const before = { status: staff.status };

    await prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id: staff.id },
        data: { status: parsed.data.status },
      });

      if (staff.userProfile) {
        // The control the spec calls out as "the most commonly missed
        // control in systems of this kind" — deactivation revokes access
        // AND ends the session immediately, not just at next token expiry.
        await tx.userProfile.update({
          where: { id: staff.userProfile.id },
          data: { active: false },
        });
      }
    });

    if (staff.userProfile) {
      await revokeAllSessionsForUser(staff.userProfile.id, `staff_status_${parsed.data.status.toLowerCase()}`);
    }

    await writeAuditLog({
      facilityId: staff.facilityId,
      actorEmail: req.auth!.email,
      action: "staff_status_changed",
      entityType: "Staff",
      entityId: staff.id,
      before,
      after: { status: parsed.data.status },
      summary: `${staff.fullName}'s status changed from ${staff.status} to ${parsed.data.status} by ${req.auth!.email}; access revoked immediately.`,
    });

    res.status(204).send();
  }
);
