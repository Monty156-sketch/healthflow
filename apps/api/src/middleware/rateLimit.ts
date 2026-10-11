import rateLimit from "express-rate-limit";

// Five attempts an hour, per the spec's registration/verification rate
// limit (Part 6, section 10). Applied per-IP; account lockout (lib/mfa.ts
// + the login route) is the separate per-account control.
export const authAttemptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_attempts", retryAfterMinutes: 60 },
});

// Looser limit for authenticated, routine API traffic.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
