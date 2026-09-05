import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const scanner = resolve("scripts/git-secret-scan.mjs");
const gitleaks = process.env.GITLEAKS_BINARY;
function git(dir, args) { return execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" }); }
function commit(dir) { git(dir, ["add", "-A"]); git(dir, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]); }
function scan(dir) { return spawnSync(process.execPath, [scanner], { cwd: dir, encoding: "utf8" }); }
for (const scenario of ["removed-history-secret", "safe-placeholder", "template-secret", "shallow"]) {
  test(`full history: ${scenario}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "navega-history-"));
    const clone = dir + "-shallow";
    try {
      git(dir, ["init", "-q"]);
      const secret = "ghp_" + "Ab3dE5fG7hJ9kL2mN4pQ6rS8tU1vW3xY5zA7";
      const file = scenario === "template-secret" ? ".env.example" : "config.txt";
      writeFileSync(join(dir, file), scenario === "safe-placeholder" ? "AI_API_KEY=sk-your-nan-builders-key" : `credential=${secret}`);
      commit(dir);
      if (scenario === "removed-history-secret" || scenario === "shallow") { writeFileSync(join(dir, file), "removed"); commit(dir); }
      if (scenario === "shallow") {
        git(dir, ["clone", "--depth=1", pathToFileURL(dir).href, clone]);
        const result = scan(clone);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /non-shallow/);
      } else {
        const result = scan(dir);
        assert.equal(result.status, scenario === "safe-placeholder" ? 0 : 1);
        assert.equal((result.stdout + result.stderr).includes(secret), false);
        if (gitleaks) {
          const gl = spawnSync(gitleaks, ["git", "--no-banner", "--redact=100", "--log-opts=--all", dir], { encoding: "utf8" });
          assert.equal(gl.status, scenario === "safe-placeholder" ? 0 : 1);
          assert.equal((gl.stdout + gl.stderr).includes(secret), false);
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(clone, { recursive: true, force: true }); }
  });
}
