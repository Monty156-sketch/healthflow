// Password rules, following NIST SP 800-63B: length matters, composition
// rules ("one capital, one symbol") do not, and commonly used passwords are
// refused. Messages are written for the person choosing the password.

const MIN = 12;
const MAX = 128;

// The passwords most often seen in breaches, plus local favourites. A
// password that contains only one of these (ignoring case, digits and
// symbols around it) is refused.
const COMMON = new Set([
  "password", "passw0rd", "123456789012", "qwertyuiop", "qwerty123456", "iloveyou",
  "welcome", "letmein", "admin", "administrator", "healthflow", "ghana", "accra",
  "kumasi", "tamale", "wa", "upperwest", "nurse", "midwife", "doctor", "hospital",
  "healthcentre", "clinic", "sombo", "monkey", "dragon", "football", "baseball",
  "sunshine", "princess", "abc123", "trustno1", "changeme", "default", "secret",
]);

export function checkPassword(password: string, email?: string): string | null {
  if (password.length < MIN) return `Use at least ${MIN} characters. A few unrelated words make a strong, memorable password.`;
  if (password.length > MAX) return `Use ${MAX} characters or fewer.`;
  const core = password.toLowerCase().replace(/[^a-z]/g, "");
  if (COMMON.has(core) || /^(.)\1+$/.test(password) || /^(0123456789|1234567890)+/.test(password)) {
    return "This password is too common or too easy to guess. Choose something else.";
  }
  if (email) {
    const local = email.split("@")[0].toLowerCase();
    if (local.length >= 4 && password.toLowerCase().includes(local)) {
      return "Do not include your email address in your password.";
    }
  }
  return null;
}
