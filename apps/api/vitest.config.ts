import { defineConfig } from "vitest/config";

// Integration tests: the real Express app against a real Postgres
// (DATABASE_URL, a throwaway database in CI). One file at a time, because
// every test file resets the same database.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/globalGuard.ts"],
    fileParallelism: false,
    // In CI, failures also show as annotations on the check run.
    reporters: process.env.GITHUB_ACTIONS ? ["default", "github-actions"] : ["default"],
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: "test",
      JWT_ACCESS_SECRET: "test-access-secret-not-for-production-use",
      JWT_REFRESH_PEPPER: "test-refresh-pepper-not-for-production-use",
      // 32 zero bytes, base64. Test only.
      MFA_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      PROXY_SHARED_SECRET: "test-proxy-secret",
      WEB_ORIGIN: "http://localhost:3000",
    },
  },
});
