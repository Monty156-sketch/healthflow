// Argon2id password hashing — the current OWASP recommendation, stronger
// than bcrypt against GPU-accelerated cracking. Also used for recovery
// codes, which are hashed the same way as passwords.
import argon2 from "argon2";

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 19456, // ~19 MB, OWASP's current minimum recommendation
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
