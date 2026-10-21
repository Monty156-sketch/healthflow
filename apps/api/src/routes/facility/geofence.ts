// The facility's clock-in area, set by the administrator in settings.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { parseOr400 } from "../../lib/validate.js";
import { allowRoles, caller, ADMIN_ROLES } from "../../middleware/facilityAccess.js";

export const geofenceRouter = Router();

const present = (f: { geoLat: number | null; geoLng: number | null; geoRadiusM: number | null }) => ({
  set: f.geoLat !== null && f.geoLng !== null && f.geoRadiusM !== null,
  lat: f.geoLat, lng: f.geoLng, radiusM: f.geoRadiusM,
});

geofenceRouter.get("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const f = await prisma.facility.findUniqueOrThrow({ where: { id: caller(req).facilityId }, select: { geoLat: true, geoLng: true, geoRadiusM: true } });
  res.json(present(f));
});

const input = z.object({
  lat: z.number({ invalid_type_error: "Enter the latitude." }).min(-90, "Latitude is between -90 and 90.").max(90, "Latitude is between -90 and 90."),
  lng: z.number({ invalid_type_error: "Enter the longitude." }).min(-180, "Longitude is between -180 and 180.").max(180, "Longitude is between -180 and 180."),
  radiusM: z.number({ invalid_type_error: "Enter the distance in metres." }).int("Use a whole number of metres.").min(30, "At least 30 metres.").max(1000, "No more than 1,000 metres."),
});

geofenceRouter.put("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  const body = parseOr400(input, req.body, res);
  if (!body) return;
  const f = await prisma.facility.update({ where: { id: who.facilityId }, data: { geoLat: body.lat, geoLng: body.lng, geoRadiusM: body.radiusM }, select: { geoLat: true, geoLng: true, geoRadiusM: true } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "geofence_set", entityType: "Facility", entityId: who.facilityId, summary: `${who.displayName} set the clock-in area to ${body.radiusM} metres around the facility.` });
  res.json(present(f));
});

geofenceRouter.delete("/", allowRoles(...ADMIN_ROLES), async (req, res) => {
  const who = caller(req);
  await prisma.facility.update({ where: { id: who.facilityId }, data: { geoLat: null, geoLng: null, geoRadiusM: null } });
  await writeAuditLog({ facilityId: who.facilityId, actorEmail: who.email, action: "geofence_cleared", entityType: "Facility", entityId: who.facilityId, summary: `${who.displayName} turned off clocking in and out.` });
  res.json(present({ geoLat: null, geoLng: null, geoRadiusM: null }));
});
