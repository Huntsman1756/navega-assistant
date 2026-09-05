import { defineConfig } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_PORT = 18787;
const FIXTURES_PORT = 14173;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${FIXTURES_PORT}`,
    headless: true,
  },
  webServer: [
    {
      command: `node ../api/dist/index.js`,
      cwd: __dirname,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      env: { AI_PROVIDER: "mock", PORT: String(API_PORT) },
      timeout: 120000,
    },
    {
      command: `node e2e/fixtures-server.mjs ../../tests/fixtures ${FIXTURES_PORT}`,
      cwd: __dirname,
      url: `http://localhost:${FIXTURES_PORT}/login.html`,
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
