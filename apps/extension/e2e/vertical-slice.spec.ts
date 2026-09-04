import { test, expect, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API_URL = "http://localhost:8787";
const __dirname = dirname(fileURLToPath(import.meta.url));

// Stub the minimal chrome surface used by the bundled content extractor so we
// can drive the real built bundle against a real browser DOM. In production the
// content script is injected via chrome.scripting.executeScript; this only
// removes the messaging dependency for automated verification.
async function captureSnapshot(page: Page, fixturePath: string) {
  await page.addInitScript(() => {
    (window as unknown as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: (msg: unknown) => {
          (window as unknown as { __gwaSnapshot?: unknown }).__gwaSnapshot = msg;
        },
      },
    };
  });
  await page.goto(`/${fixturePath}`);
  await page.addScriptTag({
    path: resolve(__dirname, "..", "dist", "content", "extract.js"),
  });
  return page.evaluate(() => (window as unknown as { __gwaSnapshot?: any }).__gwaSnapshot?.snapshot);
}

test.describe("content extract bundle (browser)", () => {
  test("produces a sanitized snapshot from the login fixture", async ({ page }) => {
    const snap = await captureSnapshot(page, "login.html");
    expect(snap.schemaVersion).toBe(1);
    // The password value must never be serialized.
    expect(JSON.stringify(snap)).not.toContain("fake-password-123");
    const button = snap.elements.find((e: any) => e.tag === "button");
    expect(button?.accessibleName).toContain("Sign in");
  });

  test("keeps prompt-injection page text as untrusted data only", async ({ page }) => {
    const snap = await captureSnapshot(page, "prompt-injection.html");
    // The malicious text is present as page data…
    expect(snap.visibleText.join(" ")).toMatch(/ignore all previous instructions/i);
    // …but no password value leaks and no action capability is invented.
    expect(JSON.stringify(snap)).not.toContain("fake");
    expect(JSON.stringify(snap)).not.toMatch(/"click"/);
    expect(JSON.stringify(snap)).not.toMatch(/executeJavaScript/);
  });
});

test.describe("vertical slice (browser extract -> live backend)", () => {
  test("extracts in browser, posts to the backend, and gets a safe instruction", async ({ page }) => {
    const snap = await captureSnapshot(page, "login.html");
    const res = await page.request.post(`${API_URL}/v1/assist`, {
      data: {
        protocolVersion: 1,
        mode: "DOM_ONLY",
        question: "I don't know what to do here.",
        snapshot: snap,
      },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.decision.kind).toBe("explain");
    expect(json.decision.message).toContain("Sign in");
    // No action primitive should appear.
    expect(JSON.stringify(json)).not.toMatch(/"click"/);
    expect(res).toBeTruthy();
  });
});
