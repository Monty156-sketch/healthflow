// Calls made by a scheduler, not by a person. Guarded by a shared secret; with
// no secret configured they answer as if they were not there.
import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { runRetentionJob } from "../lib/retention.js";

export const internalRouter = Router();

internalRouter.post("/retention-scan", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = String(req.header("x-cron-secret") ?? "");
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return res.status(404).json({ error: "not_found" });
  res.json(await runRetentionJob());
});
