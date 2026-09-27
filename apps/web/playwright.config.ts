import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataFile = join(mkdtempSync(join(tmpdir(), "hooklens-browser-")), "store.json");

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/demo/**",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:5183", trace: "on-first-retry" },
  webServer: [
    { command: "pnpm --filter @hooklens/api dev", url: "http://127.0.0.1:8787/api/health", reuseExistingServer: false, env: { HOOKLENS_DATA_FILE: dataFile, HOOKLENS_TOKEN: "browser-test-token-local-only", PUBLIC_BASE_URL: "http://127.0.0.1:5183" } },
    { command: "pnpm exec vite --host 127.0.0.1 --port 5183 --strictPort", url: "http://127.0.0.1:5183", reuseExistingServer: false },
  ],
});
