import { test, expect } from "@playwright/test";
import { get } from "node:http";

function status(path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get({ hostname: "127.0.0.1", port: 4173, path }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    }).on("error", reject);
  });
}

test("fixture server survives malformed escapes, directories, missing files and traversal", async () => {
  for (const [path, expected] of [["/%ZZ", 400], ["/./", 404], ["/missing.html", 404], ["/%2e%2e/package.json", 404], ["/..%5cpackage.json", 404]] as const) {
    expect(await status(path)).toBe(expected);
    expect(await status("/login.html")).toBe(200);
  }
});
