// The Express app, without starting a server. server.ts listens on a port;
// the integration tests drive this same app directly.
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { authRouter } from "./routes/auth.js";
import { accountRouter } from "./routes/account.js";
import { facilityRouter } from "./routes/facility/index.js";
import { invitationRouter } from "./routes/invitations.js";
import { errorReportRouter, platformRouter, recordServerError } from "./routes/errors.js";
import { apiLimiter } from "./middleware/rateLimit.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1); // Render sits behind a proxy; needed for correct req.ip

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
      credentials: true, // the refresh-token cookie needs this
    })
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  if (process.env.NODE_ENV !== "test") {
    app.use(pinoHttp({ redact: ["req.headers.authorization", "req.headers.cookie"] }));
  }
  app.use(apiLimiter);

  // Pinged by the keep-awake workflow so the free Render instance stays warm.
  app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Under /api/auth because the session cookie is scoped to that path, and
  // the account routes need it to tell this device from the others.
  app.use("/api/auth/account", accountRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/facility", facilityRouter);
  app.use("/api/invitations", invitationRouter);
  app.use("/api/errors", errorReportRouter);
  app.use("/api/platform", platformRouter);

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  // Express 5 routes async errors here. Log the detail, never send it.
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // A malformed or oversized request body is the sender's mistake, not ours.
    const status = (err as Error & { status?: number }).status;
    if (status === 400 || status === 413) {
      return res.status(status).json({ error: status === 413 ? "too_large" : "invalid_body" });
    }
    if (req.log) req.log.error(err);
    else console.error(err);
    void recordServerError(req, err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
