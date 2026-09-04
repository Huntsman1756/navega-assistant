import { test, expect, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  // Inject via CDP (Runtime.evaluate) so the test is robust to any page CSP.
  // The real extension injects this bundle through chrome.scripting.executeScript.
  const script = readFileSync(resolve(__dirname, "..", "dist", "content", "extract.js"), "utf8");
  await page.evaluate(`(function(){${script}})()`);
  return page.evaluate(() => (window as unknown as { __gwaSnapshot?: any }).__gwaSnapshot?.snapshot);
}

function emptySession() {
  return { schemaVersion: 1, sessionId: "e2e-s1", turns: [] };
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
        protocolVersion: 2,
        mode: "DOM_ONLY",
        question: "I don't know what to do here.",
        snapshot: snap,
        session: emptySession(),
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

test.describe("help session vertical (mock provider, deterministic)", () => {
  test("second request sees the previous help context and a fresh snapshot", async ({ page }) => {
    // First request: no history yet.
    const snap1 = await captureSnapshot(page, "login.html");
    const res1 = await page.request.post(`${API_URL}/v1/assist`, {
      data: {
        protocolVersion: 2,
        mode: "DOM_ONLY",
        question: "¿Qué es esta página?",
        snapshot: snap1,
        session: emptySession(),
      },
    });
    expect(res1.status()).toBe(200);
    const json1 = await res1.json();
    expect(json1.decision.message).not.toContain("Sigamos.");
    expect(json1.decision.message).toContain("Sign in");

    // Build the conversation from turn 1.
    const session = {
      schemaVersion: 1,
      sessionId: "e2e-s1",
      goal: "¿Qué es esta página?",
      currentOrigin: snap1.page.origin,
      turns: [
        { role: "user", text: "¿Qué es esta página?", timestamp: 1 },
        { role: "assistant", text: json1.decision.message, timestamp: 2 },
      ],
    };

    // Second request on a DIFFERENT page (fresh snapshot).
    const snap2 = await captureSnapshot(page, "product.html");
    const res2 = await page.request.post(`${API_URL}/v1/assist`, {
      data: {
        protocolVersion: 2,
        mode: "DOM_ONLY",
        question: "¿Y qué hago ahora?",
        snapshot: snap2,
        session,
      },
    });
    expect(res2.status()).toBe(200);
    const json2 = await res2.json();
    // The mock provider acknowledges it received the previous help context…
    expect(json2.decision.message).toContain("Sigamos.");
    // …and it is guiding using the CURRENT page, not the stale one.
    expect(json2.decision.message).not.toContain("Sign in");
  });
});

test.describe("site access / permission UX (real side-panel bundle + stubbed chrome)", () => {
  test("missing origin permission shows a permission prompt, then grants and retries", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {
        chrome?: unknown;
        __gwa?: { granted: boolean; assistCalls: number; permissionRequests: number; snapshotListener?: (m: unknown) => void };
      };
      const state = { granted: false, assistCalls: 0, permissionRequests: 0 };
      w.__gwa = state;
      w.chrome = {
        tabs: { query: async () => [{ id: 1, url: "https://mail.google.com/mail" }] },
        scripting: {
          executeScript: async () => {
            if (!state.granted) {
              throw new Error(
                "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
              );
            }
            state.snapshotListener?.({
              type: "GWA_SNAPSHOT",
              snapshot: {
                schemaVersion: 1,
                snapshotId: "s",
                page: { url: "https://mail.google.com/mail", origin: "https://mail.google.com", title: "Recibidos" },
                elements: [
                  { id: "el-0", tag: "button", role: "button", accessibleName: "Recibidos", interactive: true },
                ],
                visibleText: ["Recibidos"],
              },
            });
          },
        },
        runtime: {
          onMessage: {
            addListener: (cb: (m: unknown) => void) => {
              state.snapshotListener = cb;
            },
            removeListener: () => {},
          },
          sendMessage: async () => {
            state.assistCalls += 1;
            return {
              type: "GWA_ASSIST_RESULT",
              ok: true,
              decision: { kind: "explain", message: "Pulsa “Recibidos”, a la izquierda." },
            };
          },
        },
        permissions: {
          contains: async () => state.granted,
          request: async () => {
            state.granted = true;
            state.permissionRequests += 1;
            return true;
          },
        },
        storage: { session: { get: async () => ({}), set: async () => {} } },
      };
    });

    const sidePanelUrl = pathToFileURL(resolve(__dirname, "..", "dist", "sidepanel", "index.html")).href;
    await page.goto(sidePanelUrl);

    // Empty start state.
    await expect(page.locator("#conversation")).toContainText("Cuéntame");

    await page.fill("#question", "¿Qué hago ahora?");
    await page.click("#help-btn");

    // The opaque technical error is replaced by a clear permission prompt.
    await expect(page.locator("#permission")).toBeVisible();
    await expect(page.locator("#permission-text")).toContainText("mail.google.com");

    // Grant -> retry succeeds, no double submission.
    await page.click("#permission-allow");
    await expect(page.locator("#permission")).toBeHidden();
    const state = await page.evaluate(() => (window as any).__gwa);
    expect(state.assistCalls).toBe(1);
    expect(state.permissionRequests).toBe(1);
    await expect(page.locator("#conversation")).toContainText("Pulsa “Recibidos”, a la izquierda.");
  });
});
