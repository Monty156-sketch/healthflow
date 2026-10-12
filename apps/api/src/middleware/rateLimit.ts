import rateLimit from "express-rate-limit";
import { clientIp } from "../lib/clientIp.js";

// Five attempts an hour, per the spec's registration/verification rate
// limit (Part 6, section 10). Applied per client IP; account lockout (the
// login route) is the separate per-account control.
export const authAttemptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: "too_many_attempts", retryAfterMinutes: 60 },
});

// Looser limit for authenticated, routine API traffic.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
});
