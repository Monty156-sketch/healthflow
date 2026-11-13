// Fingerprint and face sign-in in the browser. The phone does the fingerprint or face check itself;
// HealthFlow only ever receives a signed answer. Works in Chrome and Safari and in the app added to the home screen.
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api, ApiError, type Session } from "@/lib/api";

export { browserSupportsWebAuthn };

export interface PasskeyRow {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** True when the person closed or refused the phone's own fingerprint or face prompt. */
export const wasCancelled = (e: unknown) => e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError");

/** The words to show for anything that went wrong with a passkey. */
export function passkeyMessage(e: unknown): string {
  if (wasCancelled(e)) return "That was cancelled. Try again, or use your password.";
  if (e instanceof ApiError) {
    const m = (e.body as { message?: string } | undefined)?.message;
    if (m) return m;
    if (e.message === "wrong_door") return "This account signs in on a different page.";
    if (e.message === "account_locked") return "Too many wrong tries. Wait a little, then try again.";
    if (e.message === "account_inactive") return "This account is not active. Contact your facility admin.";
  }
  if (e instanceof Error && e.name === "InvalidStateError") return "This device is already set up.";
  return "Fingerprint or face sign-in did not work. Use your password instead.";
}

/** Asks the phone for a fingerprint or face and signs in with the answer. */
export async function signInWithPasskey(audience: "facility" | "district" | "platform"): Promise<Session> {
  const { options, challengeId } = await api.post<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>("/api/auth/passkey-login/options");
  const response = await startAuthentication({ optionsJSON: options });
  return api.post<Session>("/api/auth/passkey-login/verify", { challengeId, response, audience });
}

/** Turns fingerprint or face sign-in on for this device. Needs the current password. */
export async function addPasskey(password: string, deviceName?: string): Promise<PasskeyRow> {
  const { options, challengeId } = await api.post<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>("/api/auth/account/passkeys/register/options", { password });
  const response = await startRegistration({ optionsJSON: options });
  const r = await api.post<{ passkey: PasskeyRow }>("/api/auth/account/passkeys/register/verify", { challengeId, response, ...(deviceName ? { deviceName } : {}) });
  return r.passkey;
}
