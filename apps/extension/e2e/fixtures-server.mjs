import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";

// Serves the deterministic fixture pages from tests/fixtures.
// Usage: node fixtures-server.mjs <fixturesDir> <port>
const baseDir = resolve(process.argv[2] ?? join(process.cwd(), "..", "..", "tests", "fixtures"));
const port = Number(process.argv[3] || 4173);

const server = createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (urlPath.includes("\0")) throw new URIError();
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
  const target = urlPath === "/" ? "/login.html" : urlPath;
  const file = resolve(baseDir, `.${target}`);
  const rel = relative(baseDir, file);

  try {
    if (rel.startsWith("..") || isAbsolute(rel) || !statSync(file).isFile()) throw new Error();
    const content = readFileSync(file);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end("not found");
    return;
  }

});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`fixture server: http://localhost:${port} (dir: ${baseDir})\n`);
});
