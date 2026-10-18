import { Router } from "express";
import { settleReference, validSignature } from "../lib/paystack.js";

export const webhookRouter = Router();

/** Paystack tells us a payment finished. The signature proves it came from them; settling re-checks with them anyway. */
webhookRouter.post("/paystack", async (req, res) => {
  if (!validSignature((req as unknown as { rawBody?: Buffer }).rawBody, req.header("x-paystack-signature"))) return res.status(401).json({ error: "bad_signature" });
  const event = req.body as { event?: string; data?: { reference?: string } };
  if (event.event === "charge.success" && event.data?.reference) {
    try { await settleReference(event.data.reference); } catch (e) { req.log?.error(e); return res.status(500).json({ error: "try_again" }); }
  }
  res.json({ ok: true });
});
