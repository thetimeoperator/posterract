import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/billing",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5175",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "VITE_API_URL=http://127.0.0.1:5175/api VITE_CONVEX_URL= npx vite --host 127.0.0.1 --port 5175",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
