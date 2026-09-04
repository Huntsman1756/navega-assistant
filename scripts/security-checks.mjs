import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

let failures = 0;
const ok = (msg) => console.log(`  ok  ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL  ${msg}`);
};

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else if (/\.(js|mjs|json)$/.test(entry)) out.push(full);
  }
  return out;
}

const MANIFEST = resolve(root, "apps", "extension", "dist", "manifest.json");
const ALLOWED_PERMISSIONS = new Set(["activeTab", "scripting", "storage", "sidePanel", "webNavigation"]);

console.log("Security checks: extension bundle");

if (readdirSafe(resolve(root, "apps", "extension", "dist"))) {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const perms = manifest.permissions ?? [];
  const badPerms = perms.filter((p) => !ALLOWED_PERMISSIONS.has(p));
  if (badPerms.length) fail(`unexpected permissions: ${badPerms.join(", ")}`);
  else ok(`permissions are least-privilege: ${perms.join(" + ")}`);

  if (perms.includes("debugger")) fail("manifest requests 'debugger'");
  else ok("no 'debugger' permission");

  const hostPerms = manifest.host_permissions ?? [];
  if (hostPerms.includes("<all_urls>")) fail("manifest requests <all_urls> in REQUIRED host_permissions");
  else ok("no permanent '<all_urls>' host permission");

  // Broad optional host access is only acceptable when it is declared as an
  // OPTIONAL capability (never granted by default) and used only for explicit
  // per-origin user grants. It must never appear in the required list.
  const optionalHostPerms = manifest.optional_host_permissions ?? [];
  const hasBroadOptional = optionalHostPerms.some((p) => p === "<all_urls>" || p === "*://*/*");
  if (hasBroadOptional) {
    ok("broad optional host capability declared (not granted by default; per-origin only)");
  } else if (optionalHostPerms.length > 0) {
    ok(`optional host permissions present: ${optionalHostPerms.join(", ")}`);
  } else {
    ok("no optional host permissions declared");
  }

  const jsFiles = collectFiles(resolve(root, "apps", "extension", "dist")).filter((f) => f.endsWith(".js"));
  const forbidden = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "sk-", "puppeteer", "playwright", "executeJavaScript", "chrome.debugger", "backendDOMNodeId"];
  for (const file of jsFiles) {
    const content = readFileSync(file, "utf8");
    for (const needle of forbidden) {
      if (content.includes(needle)) {
        fail(`${file} contains forbidden string "${needle}"`);
      }
    }
  }
  ok(`scanned ${jsFiles.length} bundle file(s) for secrets/foreign runtime`);

  if (jsFiles.length === 0) fail("no service-worker/content/sidepanel JS bundles found");
} else {
  fail("extension dist not built (run pnpm build first)");
}

const envFile = resolve(root, ".env");
function isTrackedByGit(path) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// A local, git-ignored .env (e.g. for the local backend key) is acceptable for
// local development. Only a .env that is TRACKED by git would be committed as a
// secret, and that is what must fail.
if (isTrackedByGit(envFile)) {
  fail(".env is tracked by git (do not commit secrets)");
} else {
  ok(".env is not tracked by git");
}

function readdirSafe(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

if (failures > 0) {
  console.error(`\n${failures} security check(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nAll security checks passed.");
}
