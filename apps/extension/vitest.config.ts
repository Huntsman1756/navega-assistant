import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "dist/**", "node_modules/**"],
    environment: "node",
  },
});
