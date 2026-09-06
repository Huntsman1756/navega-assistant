/**
 * G1 baseline consistency check (NON-RUNTIME).
 *
 * Validates docs/validation/G1-BASELINE.json — the single source of truth for
 * the frozen G1 engineering baseline — against:
 *
 *   1. the actual Git tag (full 40-hex SHA resolution via git rev-parse);
 *   2. packages/protocol (PROTOCOL_VERSION constant);
 *   3. every documentation file (README.md + all markdown under docs): no
 *      occurrence of a
 *      `*-p0-g1-baseline` identifier that differs from the canonical tag is
 *      allowed (obsolete-baseline drift fails the study methodology).
 *
 * This never ships in any bundle and changes no product behavior. It runs as
 * part of `pnpm test` (root) and therefore of `pnpm verify`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_RECORD_PATH = "docs/validation/G1-BASELINE.json";
const FULL_SHA_RE = /^[0-9a-f]{40}$/;
// Matches v0.0.9-p0-g1-baseline and the unprefixed 0.0.9-p0-g1-baseline form.
const BASELINE_TOKEN_RE = /(?<![\w.])v?(0\.\d+\.\d+-p0-g1-baseline)(?![\w-])/g;

export function loadRecord(root = REPO_ROOT) {
  const record = JSON.parse(readFileSync(join(root, BASELINE_RECORD_PATH), "utf8"));
  assert.match(
    record.sha,
    FULL_SHA_RE,
    `${BASELINE_RECORD_PATH}: sha must be a full 40-character hex commit SHA, got ${JSON.stringify(record.sha)}`,
  );
  assert.ok(
    /^v0\.\d+\.\d+-p0-g1-baseline$/.test(record.tag),
    `${BASELINE_RECORD_PATH}: tag must be an exact vX.Y.Z-p0-g1-baseline tag, got ${JSON.stringify(record.tag)}`,
  );
  assert.equal(typeof record.protocolVersion, "number");
  return record;
}

/**
 * Resolve the commit the annotated tag points at (read-only; never moves the
 * tag). Local resolution first; CI checkouts may omit annotated tag objects,
 * so fall back to a single-tag fetch with an explicit refspec, then to a
 * read-only `git ls-remote` peel query against origin.
 */
export function resolveTagSha(tag, root = REPO_ROOT) {
  const attempts = [];
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 60000 });
    const err = (r.stderr ?? "").trim().split("\n")[0] ?? "";
    attempts.push(`git ${args.join(" ")} -> exit ${r.status}${err ? ` (${err})` : ""}`);
    return r;
  };
  let res = run(["rev-parse", "--verify", `${tag}^{commit}`]);
  if (res.status !== 0) {
    run(["fetch", "--quiet", "origin", `+refs/tags/${tag}:refs/tags/${tag}`]);
    res = run(["rev-parse", "--verify", `${tag}^{commit}`]);
  }
  if (res.status === 0) {
    const sha = res.stdout.trim();
    assert.match(sha, FULL_SHA_RE, `tag ${tag} did not resolve to a full SHA: ${sha}`);
    return sha;
  }
  const remote = run(["ls-remote", "--tags", "origin", `${tag}^{}`]);
  if (remote.status === 0) {
    const line = remote.stdout
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.includes(`refs/tags/${tag}`));
    if (line) {
      const sha = line.split(/\s+/)[0];
      assert.match(
        sha,
        FULL_SHA_RE,
        `remote peel of ${tag} did not return a full commit SHA: ${line}`,
      );
      return sha;
    }
    attempts.push(`ls-remote returned no peel line for refs/tags/${tag}`);
  }
  assert.fail(
    `cannot resolve tag ${tag} locally or on origin:\n  ${attempts.join("\n  ")}`,
  );
}

export function protocolVersionFromSource(root = REPO_ROOT) {
  const src = readFileSync(join(root, "packages/protocol/src/index.ts"), "utf8");
  const m = src.match(/export const PROTOCOL_VERSION\s*=\s*(\d+)/);
  assert.ok(m, "PROTOCOL_VERSION constant not found in packages/protocol/src/index.ts");
  return Number(m[1]);
}

/** Compare the record's declared SHA with the SHA Git currently resolves for its tag. */
export function verifyRecordAgainstResolvedSha(record, resolvedSha) {
  const problems = [];
  if (record.sha !== resolvedSha) {
    problems.push(
      `${BASELINE_RECORD_PATH} sha ${record.sha} disagrees with ${record.tag} -> ${resolvedSha}`,
    );
  }
  return problems;
}

export function* markdownDocs(root = REPO_ROOT) {
  yield join(root, "README.md");
  const walk = function* (dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) yield* walk(full);
      else if (entry.endsWith(".md")) yield full;
    }
  };
  yield* walk(join(root, "docs"));
}

/** Return every obsolete baseline reference: {file, line, token, canonical}. */
export function findBaselineDrift(root = REPO_ROOT, canonicalTag = loadRecord(root).tag) {
  const canonicalNumeric = canonicalTag.replace(/^v/, "");
  const findings = [];
  for (const file of markdownDocs(root)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((text, i) => {
      for (const match of text.matchAll(BASELINE_TOKEN_RE)) {
        if (match[1] !== canonicalNumeric) {
          findings.push({
            file: file.slice(root.length + 1),
            line: i + 1,
            token: match[0],
            canonical: canonicalTag,
          });
        }
      }
    });
  }
  return findings;
}

function formatFindings(findings) {
  return findings
    .map((f) => `  ${f.file}:${f.line} references obsolete G1 baseline '${f.token}'; canonical is '${f.canonical}' (${BASELINE_RECORD_PATH})`)
    .join("\n");
}

test("G1-BASELINE.json is well-formed", () => {
  const record = loadRecord();
  assert.ok(record.tag.startsWith("v"));
  assert.ok(record.protocolVersion >= 1);
});

test("G1-BASELINE.json matches the actual Git tag (tag never moved by this check)", () => {
  const record = loadRecord();
  const resolved = resolveTagSha(record.tag);
  assert.deepEqual(verifyRecordAgainstResolvedSha(record, resolved), []);
});

test("G1-BASELINE.json protocolVersion matches packages/protocol", () => {
  const record = loadRecord();
  assert.equal(
    record.protocolVersion,
    protocolVersionFromSource(),
    "protocolVersion disagrees with PROTOCOL_VERSION in packages/protocol/src/index.ts",
  );
});

test("no validation documentation references an obsolete G1 baseline", () => {
  const findings = findBaselineDrift();
  assert.equal(findings.length, 0, `obsolete G1 baseline references:\n${formatFindings(findings)}`);
});

test("DELIBERATE STALE FIXTURE: checker rejects an obsolete baseline string", () => {
  const tmp = mkdtempSync(join(tmpdir(), "g1-baseline-drift-"));
  try {
    const record = loadRecord();
    // Minimal fake docs tree: canonical record + one doc naming an older tag.
    mkdirSync(join(tmp, "docs/validation"), { recursive: true });
    writeFileSync(join(tmp, BASELINE_RECORD_PATH), JSON.stringify(record));
    writeFileSync(
      join(tmp, "docs", "STALE.md"),
      "The G1 artifact is `v0.0.8-p0-g1-baseline` (an older frozen baseline).\n",
    );
    writeFileSync(join(tmp, "README.md"), `current: ${record.tag}\n`);
    const findings = findBaselineDrift(tmp);
    assert.equal(findings.length, 1, "expected exactly one drift finding in the stale fixture");
    assert.equal(findings[0].token, "v0.0.8-p0-g1-baseline");
    assert.equal(findings[0].line, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("DELIBERATE MISMATCH FIXTURE: a record disagreeing with the git tag is rejected", () => {
  const record = loadRecord();
  const resolved = resolveTagSha(record.tag);
  const staleRecord = { ...record, sha: "f".repeat(40) };
  const problems = verifyRecordAgainstResolvedSha(staleRecord, resolved);
  assert.equal(problems.length, 1, "a stale sha in the record must be flagged");
  assert.match(problems[0], /disagrees with/);
  // The real record must still be clean against the same resolution.
  assert.deepEqual(verifyRecordAgainstResolvedSha(record, resolved), []);
});
