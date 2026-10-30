// Error capture (Part 3, 0.7): every unhandled error is recorded with the
// screen, the person's role and what they were doing, and people can report
// a problem themselves. Platform admins see them on the System health screen.
import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Prisma } from "@healthflow/db";
import { prisma } from "../lib/prisma.js";
import { parseOr400 } from "../lib/validate.js";
import { consoleRouter } from "./platformConsole.js";
import { requireAuth } from "../middleware/auth.js";
import { requireLiveUser, liveUser } from "../middleware/liveUser.js";
import { jobStatus } from "../lib/scheduler.js";
import { sendEmail } from "../lib/email.js";
import { patientProblem } from "../lib/patientData.js";
import { knownNames } from "./facility/handover.js";

// One alert email per ten minutes at most, so a failing route cannot flood the inbox.
let lastAlert = 0;
function alertOwner(screen: string, message: string) {
  if (process.env.NODE_ENV === "test" || Date.now() - lastAlert < 10 * 60 * 1000) return;
  lastAlert = Date.now();
  const to = (process.env.ACCESS_REQUEST_NOTIFY ?? "muslimfroko05@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  for (const t of to) void sendEmail({ to: t, subject: "HealthFlow server error", text: `A request failed on the server.\n${screen}\n${message}\n\nDetails are on the System health screen in the platform console.` }).catch(() => {});
}

/** Keeps the technical context small and free of anything that looks like a secret. */
function safeContext(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const text = JSON.stringify(value, (k, v) =>
    /password|token|secret|authorization|cookie|totp|recovery/i.test(k) ? "[removed]" : v
  );
  if (!text) return undefined;
  return text.length > 4000 ? { truncated: text.slice(0, 4000) } : (JSON.parse(text) as Prisma.InputJsonValue);
}

/** Called from the API's error handler. Never throws. */
export async function recordServerError(req: Request, err: Error) {
  try {
    await prisma.errorReport.create({
      data: {
        facilityId: req.caller?.facilityId ?? req.liveUser?.facilityId ?? req.auth?.facilityId ?? null,
        reportedBy: "server",
        screen: `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
        description: (err.message || "Unknown error").slice(0, 500),
        technicalContext: safeContext({
          role: req.caller?.role ?? req.liveUser?.role ?? req.auth?.role ?? null,
          stack: err.stack?.split("\n").slice(0, 8).join("\n"),
        }),
      },
    });
  } catch {
    // Recording the error must never cause another one.
  } finally {
    alertOwner(`${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`, (err.message || "Unknown error").slice(0, 200));
  }
}

export const errorReportRouter = Router();
errorReportRouter.use(requireAuth, requireLiveUser);

// A broken screen can fire errors in a loop; one person gets 30 an hour.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.liveUser?.id ?? req.ip ?? "unknown",
  message: { error: "too_many_reports" },
});

const reportInput = z
  .object({
    kind: z.enum(["report", "automatic"]),
    screen: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    context: z.unknown().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "report" && (!v.description || v.description.length < 10)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["description"],
        message: "Say what you were doing and what went wrong, in a sentence or two.",
      });
    }
  });

errorReportRouter.post("/", reportLimiter, async (req, res) => {
  const me = liveUser(req);
  const input = parseOr400(reportInput, req.body, res);
  if (!input) return;
  if (input.kind === "report" && me.facilityId) {
    const { known, people } = await knownNames(me.facilityId);
    const problem = patientProblem(input.description, known, people);
    if (problem) return res.status(400).json({ error: "invalid_input", fields: { description: problem } });
  }
  const report = await prisma.errorReport.create({
    data: {
      facilityId: me.facilityId,
      reportedBy: input.kind === "automatic" ? `automatic (${me.email})` : me.email,
      screen: input.screen ?? null,
      description: input.description ?? "An error in the browser",
      technicalContext: safeContext({ role: me.role, ...((input.context as object) ?? {}) }),
    },
  });
  res.status(201).json({ id: report.id });
});

/** What this person reported, and what PS Tech answered. */
errorReportRouter.get("/mine", async (req, res) => {
  const me = liveUser(req);
  const rows = await prisma.errorReport.findMany({ where: { reportedBy: me.email }, orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ reports: rows.map((r) => ({ id: r.id, createdAt: r.createdAt, screen: r.screen, description: r.description, status: r.status, reply: r.reply, repliedAt: r.repliedAt })) });
});

// ------------------------------------------------------------- platform: system health

export const platformRouter = Router();
platformRouter.use(requireAuth, requireLiveUser, (req, res, next) => {
  // The same answer as a route that does not exist, so nothing confirms the console is here.
  if (liveUser(req).role !== "PLATFORM_ADMIN") return res.status(404).json({ error: "not_found" });
  next();
});
platformRouter.use(consoleRouter);

const startedAt = Date.now();

platformRouter.get("/health", async (_req, res) => {
  const t0 = Date.now();
  let database: { ok: boolean; ms: number | null } = { ok: true, ms: null };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true, ms: Date.now() - t0 };
  } catch {
    database = { ok: false, ms: null };
  }
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [last24h, open, recent] = await Promise.all([
    prisma.errorReport.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.errorReport.count({ where: { status: { not: "RESOLVED" } } }),
    prisma.errorReport.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { facility: { select: { name: true } } },
    }),
  ]);
  res.json({
    api: { ok: true, upSinceSeconds: Math.round((Date.now() - startedAt) / 1000) },
    database,
    errors: { last24h, open },
    // Not built yet; listed so the screen shows what it will cover.
    jobs: await jobStatus(),
    notifications: { status: "none_yet" },
    reports: recent.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      facility: r.facility?.name ?? null,
      reportedBy: r.reportedBy,
      screen: r.screen,
      description: r.description,
      technicalContext: r.technicalContext,
      status: r.status,
    })),
  });
});

const statusInput = z.object({ status: z.enum(["NEW", "INVESTIGATING", "RESOLVED"]) });

platformRouter.patch("/errors/:id", async (req, res) => {
  const input = parseOr400(statusInput, req.body, res);
  if (!input) return;
  const found = await prisma.errorReport.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
  if (!found) return res.status(404).json({ error: "not_found" });
  await prisma.errorReport.update({ where: { id: found.id }, data: { status: input.status } });
  res.json({ ok: true });
});
