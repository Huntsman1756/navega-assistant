import { execFileSync } from "node:child_process";

/**
 * Scans the ENTIRE git history (every blob across all commits/branches) for
 * likely secrets and for committed environment files. This catches secrets that
 * may have been removed from the current tree but remain in an earlier commit.
 *
 * Patterns are deliberately conservative to limit false positives. It is a
 * best-effort scan, not a proof of absence.
 */
function run(args, input) {
  return execFileSync("git", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const objects = run(["rev-list", "--objects", "--all"]).trim().split("\n").filter(Boolean);
const shaToPath = new Map();
const uniqueShas = [];
for (const line of objects) {
  const idx = line.indexOf(" ");
  const sha = line.slice(0, idx);
  const path = line.slice(idx + 1);
  if (!uniqueShas.includes(sha)) uniqueShas.push(sha);
  if (path && !shaToPath.has(sha)) shaToPath.set(sha, path);
}

const typeOut = run(["cat-file", "--batch-check=%(objectname) %(objecttype)"], uniqueShas.join("\n") + "\n");
const blobShas = [];
for (const line of typeOut.trim().split("\n")) {
  const [sha, type] = line.split(/\s+/);
  if (type === "blob") blobShas.push(sha);
}

const SECRET_PATTERNS = [
  /AI_API_KEY\s*=\s*[A-Za-z0-9][A-Za-z0-9_\-.]{10,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  /api[_-]?key\s*[:=]\s*["'][^"']{16,}["']/i,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
];

let failures = 0;
const ok = (m) => console.log(`  ok  ${m}`);
const fail = (m) => {
  failures += 1;
  console.error(`FAIL  ${m}`);
};

console.log(`Git history secret scan (${blobShas.length} blobs across all history)`);

for (const sha of blobShas) {
  const path = shaToPath.get(sha) ?? "(unknown path)";
  let content = "";
  try {
    content = run(["cat-file", "-p", sha]);
  } catch {
    continue; // binary or unreadable
  }

  if (/^\.env(\..+)?$/.test(path) && path !== ".env.example") {
    fail(`committed environment file found in history: ${path}`);
    continue;
  }
  if (path === ".env.example") {
    continue; // committed template with blank values, intentionally present
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      fail(`possible secret in history -> ${path} (matches ${pattern})`);
      break;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} git-history secret check(s) FAILED`);
  process.exit(1);
} else {
  ok("no secrets and no committed .env files found in git history");
  console.log("\nAll git-history secret checks passed.");
}
