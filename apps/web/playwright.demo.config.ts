import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e/demo",
  use: { baseURL: "http://127.0.0.1:5184/hooklens/" },
  webServer: { command: "pnpm exec vite --host 127.0.0.1 --port 5184 --strictPort", url: "http://127.0.0.1:5184/hooklens/", reuseExistingServer: false, env: { VITE_DEMO: "true" } },
});
