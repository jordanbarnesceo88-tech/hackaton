import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Removes the throwaway accounts each run creates; see e2e/global-teardown.ts.
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    // Give each run a distinct client IP so the auth rate limiter (keyed on X-Forwarded-For)
    // buckets runs independently — otherwise repeated runs share `…:unknown` and the 6th signup
    // within 15 min would hit the cap and fail spuriously.
    extraHTTPHeaders: { "x-forwarded-for": `e2e-${Date.now()}` },
    // The onboarding tour opens by itself on a first visit to «/» and, being modal, makes the
    // page under it inert — every spec that starts on the landing page (flow.spec.ts) found no
    // h1 and no links. Specs start as returning visitors; e2e/onboarding-tour.spec.ts clears
    // this to test the first visit itself.
    storageState: {
      cookies: [],
      origins: [{ origin: "http://localhost:3000", localStorage: [{ name: "onboarding-tour-seen", value: "1" }] }],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
