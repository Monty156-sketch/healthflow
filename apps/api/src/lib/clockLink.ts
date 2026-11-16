import { createHash } from "node:crypto";

/** Only this fingerprint of a link key is stored; the key itself is shown once. */
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
