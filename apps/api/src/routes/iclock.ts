// The machine's own feed. A ZKTeco machine set to "ADMS" in its Cloud Server Settings contacts a server by itself:
// it says hello, asks what to send, and posts each punch as it happens. This is that server, so a facility's machine
// can feed HealthFlow with no PC and no ZKBio Time in between.
//
// The machine is found by its serial number, which the administrator types on the Clock devices page. The machine
// sends no password, so nothing it says can do more than the ZKBio Time link already can: record a punch for someone
// who has that machine's number, for a duty they are rostered on, and never over a day already recorded or approved.
// Plain text in, plain text out, as the machines expect ("OK", "OK:3", "key=value" lines).
import express, { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { inFacilityRun } from "../lib/tenant.js";
import { rateKey } from "../lib/clientIp.js";
import { normalisePin, parseAdmsAttlog, type Punch } from "../lib/clockImport.js";
import { runPunchImport } from "../lib/clockPipeline.js";

export const iclockRouter = Router();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A machine that has been unplugged for weeks sends its whole memory when it comes back. Older punches than this are left for a file import. */
const OLDEST_PUNCH_DAYS = 45;

const serialOf = (req: Request) => {
  const v = req.query.SN ?? req.query.sn;
  const s = typeof v === "string" ? v.trim() : "";
  return /^[A-Za-z0-9]{4,40}$/.test(s) ? s : "";
};

// A machine asks every half minute or so. Counted per machine, not per hospital network, so it cannot crowd out the staff using HealthFlow.
const machineLimiter = rateLimit({
  windowMs: 60_000,
  limit: 90,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => serialOf(req) || rateKey(req),
  handler: (_req, res) => { res.status(429).type("text/plain").send("BUSY"); },
});

iclockRouter.use(machineLimiter);
// The machine posts plain text, with whatever content type its firmware chooses.
iclockRouter.use(express.text({ type: () => true, limit: "2mb" }));

async function deviceFor(serial: string) {
  const found = await prisma.clockDevice.findMany({
    where: { serialNumber: { equals: serial, mode: "insensitive" }, active: true },
    select: { id: true, name: true, facilityId: true, lastSeenAt: true },
    take: 2,
  });
  // Two facilities with the same serial number would send punches to the wrong place, so neither is trusted.
  return found.length === 1 ? found[0] : null;
}
type Device = NonNullable<Awaited<ReturnType<typeof deviceFor>>>;

async function seen(d: Device) {
  if (d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 2 * 60_000) return;
  await prisma.clockDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
}

const text = (res: express.Response, status: number, body: string) => res.status(status).type("text/plain").send(body);

// The machine's first call, and again whenever it restarts: it asks how to behave.
// Only punches are asked for (never fingerprints, faces or photos), the moment they happen, and the machine asks for work every 30 seconds.
iclockRouter.get("/cdata", async (req, res) => {
  const serial = serialOf(req);
  const d = serial ? await deviceFor(serial) : null;
  if (!d) return text(res, 404, "UNKNOWN DEVICE");
  await seen(d);
  text(res, 200, [
    `GET OPTION FROM: ${serial}`,
    "ErrorDelay=60",
    "Delay=30",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=TransData AttLog",
    "Realtime=1",
    "Encrypt=0",
    "",
  ].join("\n"));
});

// Punches. "OK:n" tells the machine n records were taken, so it does not send them again.
iclockRouter.post("/cdata", async (req, res) => {
  const serial = serialOf(req);
  const d = serial ? await deviceFor(serial) : null;
  if (!d) return text(res, 404, "UNKNOWN DEVICE");
  const body = typeof req.body === "string" ? req.body : "";
  if (String(req.query.table ?? "").toUpperCase() !== "ATTLOG") {
    await seen(d);
    return text(res, 200, "OK");
  }
  const parsed = parseAdmsAttlog(body);
  const lines = body.split(/\r?\n/).filter((l) => l.trim()).length;
  const now = Date.now();
  const fresh = parsed.punches.filter((p) => p.at.getTime() <= now + DAY && p.at.getTime() >= now - OLDEST_PUNCH_DAYS * DAY);
  if (fresh.length) await takePunches(d, fresh, parsed.skipped + (parsed.punches.length - fresh.length));
  else await seen(d);
  text(res, 200, `OK:${lines}`);
});

/**
 * The punches become attendance exactly as they do from the ZKBio Time link. A machine sends one punch at a time, so a
 * check-out arrives without its check-in. The same people's punches of the last 20 hours (kept from earlier) go in with it,
 * so the departure is found and added to the day already recorded.
 */
async function takePunches(d: Device, fresh: Punch[], skipped: number) {
  await inFacilityRun(d.facilityId, async () => {
    const staff = await prisma.staff.findMany({ where: { facilityId: d.facilityId, archivedAt: null, clockNumber: { not: null } }, select: { id: true, clockNumber: true } });
    const wanted = new Set(fresh.map((p) => normalisePin(p.pin)));
    const mine = staff.filter((s) => wanted.has(normalisePin(s.clockNumber!)));
    const pinOf = new Map(mine.map((s) => [s.id, s.clockNumber!]));
    const since = new Date(Math.min(...fresh.map((p) => p.at.getTime())) - 20 * HOUR);
    const past = mine.length
      ? await prisma.devicePunch.findMany({ where: { deviceId: d.id, staffId: { in: mine.map((s) => s.id) }, at: { gte: since } }, select: { staffId: true, at: true, state: true } })
      : [];
    const key = (pin: string, at: Date) => `${normalisePin(pin)}|${at.getTime()}`;
    const have = new Set(fresh.map((p) => key(p.pin, p.at)));
    const context: Punch[] = past.flatMap((r) => {
      const pin = pinOf.get(r.staffId);
      if (!pin || have.has(key(pin, r.at))) return [];
      return [{ pin, at: r.at, ...(r.state === "IN" || r.state === "OUT" ? { state: r.state } : {}) }];
    });
    await runPunchImport({ facilityId: d.facilityId, device: d, punches: [...context, ...fresh], skipped, apply: true, audit: false, actor: "Clock machine", actorEmail: "clock-machine" });
    await prisma.clockDevice.update({ where: { id: d.id }, data: { lastPushAt: new Date(), lastPushCount: fresh.length, lastSeenAt: new Date() } });
  });
}

// The machine asking whether the server has any commands for it. There are none: HealthFlow never changes a machine.
iclockRouter.get("/getrequest", async (req, res) => {
  const serial = serialOf(req);
  const d = serial ? await deviceFor(serial) : null;
  if (!d) return text(res, 404, "UNKNOWN DEVICE");
  await seen(d);
  text(res, 200, "OK");
});

iclockRouter.post("/devicecmd", async (req, res) => {
  const serial = serialOf(req);
  const d = serial ? await deviceFor(serial) : null;
  if (!d) return text(res, 404, "UNKNOWN DEVICE");
  text(res, 200, "OK");
});

iclockRouter.get("/ping", (_req, res) => text(res, 200, "OK"));
