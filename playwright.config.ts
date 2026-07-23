import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/multiplayer",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:5173", headless: true },
  webServer: {
    command: "npm.cmd run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
