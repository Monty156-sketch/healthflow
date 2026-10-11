import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { authRouter } from "./routes/auth.js";
import { staffRouter } from "./routes/staff.js";
import { apiLimiter } from "./middleware/rateLimit.js";

const app = express();

app.set("trust proxy", 1); // Render sits behind a proxy; needed for correct req.ip

app.use(helmet());
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true, // the refresh-token cookie needs this
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(pinoHttp({ redact: ["req.headers.authorization", "req.headers.cookie"] }));
app.use(apiLimiter);

// GitHub Actions/uptime-pinger hits this to keep the Render free instance
// from sleeping during business hours — see README "Keeping the free tier awake".
app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRouter);
app.use("/api/staff", staffRouter);

app.use((req, res) => res.status(404).json({ error: "not_found" }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log?.error(err);
  res.status(500).json({ error: "internal_error" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`HealthFlow API listening on :${port}`);
});
