import rateLimit from "express-rate-limit";
import { rateKey } from "../lib/clientIp.js";

// Five attempts an hour, per the spec's registration/verification rate
// limit (Part 6, section 10). Applied per client IP; account lockout (the
// login route) is the separate per-account control.
export const authAttemptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rateKey(req),
  message: { error: "too_many_attempts", retryAfterMinutes: 60 },
});

// Sign-in: only failed attempts count, so a clinic sharing one network is
// not locked out by its own successful logins. Per-account lockout still
// stops guessing against a single user.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rateKey(req),
  message: { error: "too_many_attempts", retryAfterMinutes: 15 },
});

// Looser limit for authenticated, routine API traffic.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rateKey(req),
});
