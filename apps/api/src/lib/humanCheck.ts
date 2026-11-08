// The "verify you are human" check (Cloudflare Turnstile) for staff sign-in.
// Staff accounts have no authenticator app, so this is what stands between a
// stolen or guessed password and a bot. Roles that use an authenticator code
// never see it. Off until TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY are set.
export const humanCheckOn = () => Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY);
export const humanCheckSiteKey = () => process.env.TURNSTILE_SITE_KEY ?? "";

export async function passedHumanCheck(token: string, ip?: string): Promise<boolean> {
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY ?? "", response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    // If Cloudflare cannot be reached the check fails closed; the person tries again.
    return false;
  }
}
