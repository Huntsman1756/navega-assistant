import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, normalize } from "node:path";

// Serves the deterministic fixture pages from tests/fixtures.
// Usage: node fixtures-server.mjs <fixturesDir> <port>
const baseDir = normalize(process.argv[2] ?? join(process.cwd(), "..", "..", "tests", "fixtures"));
const port = Number(process.argv[3] || 4173);

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const target = urlPath === "/" ? "/login.html" : urlPath;
  const file = normalize(join(baseDir, target));

  if (!file.startsWith(baseDir) || !existsSync(file)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(readFileSync(file));
});

server.listen(port, () => {
  process.stdout.write(`fixture server: http://localhost:${port} (dir: ${baseDir})\n`);
});
