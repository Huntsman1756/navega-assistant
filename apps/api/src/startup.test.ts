import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("normal startup scripts use native root env-file and clean process selects intended provider without a call", () => {
  const dir = mkdtempSync(join(tmpdir(), "navega-env-"));
  try {
    const file = join(dir, ".env");
    writeFileSync(file, ["AI_PROVIDER=openai-compatible", "AI_BASE_URL=https://api.nan.builders/v1", "AI_MODEL=qwen3.6", "AI_API_KEY=synthetic-only"].join("\n"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AI_") && key !== "NODE_OPTIONS"));
    const child = spawnSync(process.execPath, [`--env-file=${file}`, "--import", "tsx", "--input-type=module", "-e", "import {loadConfig} from './src/config.ts'; const c=loadConfig(); console.log(JSON.stringify({provider:c.providerName,model:c.model}));"], { cwd: process.cwd(), env, encoding: "utf8" });
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ provider: "openai-compatible", model: "qwen3.6" });
    expect(child.stdout.includes("synthetic-only")).toBe(false);
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts.dev).toContain("node --env-file=../../.env --import tsx");
    expect(scripts.start).toContain("node --env-file=../../.env");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
