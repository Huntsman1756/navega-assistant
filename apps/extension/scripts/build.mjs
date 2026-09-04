import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(root, "dist");

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

// Clean dist
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: {
    "content/extract": resolve(root, "src/content/extract.ts"),
    "service-worker/index": resolve(root, "src/service-worker/index.ts"),
    "sidepanel/index": resolve(root, "src/sidepanel/script.ts"),
  },
  bundle: true,
  outdir: outDir,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  sourcemap: true,
  logLevel: "info",
});

// Copy static assets
copyFileSync(resolve(root, "manifest", "manifest.json"), resolve(outDir, "manifest.json"));
const sidePanelDir = resolve(outDir, "sidepanel");
copyFileSync(resolve(root, "src", "sidepanel", "index.html"), resolve(sidePanelDir, "index.html"));
copyFileSync(resolve(root, "src", "sidepanel", "styles.css"), resolve(sidePanelDir, "styles.css"));

console.log("Extension built to", outDir);
