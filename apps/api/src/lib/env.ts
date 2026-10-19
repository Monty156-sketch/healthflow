// Checks the settings the API cannot run safely without, at start-up, so a
// missing secret stops the deploy with a clear message instead of failing
// on someone's first sign-in. Nothing is printed except the names.
const REQUIRED_IN_PRODUCTION = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_PEPPER", "MFA_ENCRYPTION_KEY", "WEB_ORIGIN"];
const MIN_SECRET_LENGTH = 32;

/** Missing settings stop a production start. Odd-looking ones are only warned about, so a setting that works today cannot take the site down. */
export function checkEnvironment(env: NodeJS.ProcessEnv = process.env): { missing: string[]; warnings: string[] } {
  const problems: string[] = [];
  const missing: string[] = [];
  for (const name of REQUIRED_IN_PRODUCTION) if (!env[name]) missing.push(`${name} is not set.`);
  for (const name of ["JWT_ACCESS_SECRET", "JWT_REFRESH_PEPPER"]) {
    const v = env[name];
    if (v && v.length < MIN_SECRET_LENGTH) problems.push(`${name} is shorter than ${MIN_SECRET_LENGTH} characters.`);
  }
  if (env.WEB_ORIGIN && !/^https:\/\//.test(env.WEB_ORIGIN)) problems.push("WEB_ORIGIN must start with https:// in production.");
  if (env.WEB_ORIGIN?.endsWith("/")) problems.push("WEB_ORIGIN must not end with a slash.");
  if (env.RESEND_API_KEY && !env.EMAIL_FROM) problems.push("RESEND_API_KEY is set but EMAIL_FROM is not.");
  return { missing, warnings: problems };
}

/** In production, refuses to start when a required setting is missing. Elsewhere it only warns. */
export function assertEnvironment() {
  const { missing, warnings } = checkEnvironment();
  if (warnings.length) console.warn(`Configuration warnings:\n- ${warnings.join("\n- ")}`);
  if (!missing.length) return;
  const text = `Configuration problems:\n- ${missing.join("\n- ")}`;
  if (process.env.NODE_ENV === "production") throw new Error(text);
  console.warn(text);
}
