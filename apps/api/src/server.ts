import "dotenv/config";
import { createApp } from "./app.js";
import { mfaKeyFingerprint } from "./lib/crypto.js";

const port = Number(process.env.PORT ?? 4000);

createApp().listen(port, () => {
  console.log(`HealthFlow API listening on :${port}`);
  console.log(`MFA key fingerprint: ${mfaKeyFingerprint()}`);
});
