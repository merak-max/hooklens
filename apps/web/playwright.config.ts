import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:5173", trace: "on-first-retry" },
  webServer: [
    { command: "pnpm --filter @hooklens/api dev", url: "http://127.0.0.1:8787/api/health", reuseExistingServer: !process.env.CI },
    { command: "pnpm --filter @hooklens/web dev", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI },
  ],
});
