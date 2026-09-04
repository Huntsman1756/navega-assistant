import { test, expect, type Page, type Frame } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const API_URL = "http://localhost:8787";
const __dirname = dirname(fileURLToPath(import.meta.url));

const extractScript = readFileSync(resolve(__dirname, "..", "dist", "content", "extract.js"), "utf8");

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
  await page.waitForTimeout(150);
  // Inject via CDP (Runtime.evaluate) so the test is robust to any page CSP.
  // The real extension injects this bundle through chrome.scripting.executeScript.
  await page.evaluate(`(function(){${extractScript}})()`);
  return page.evaluate(() => (window as unknown as { __gwaSnapshot?: any }).__gwaSnapshot?.snapshot);
}

// Frame-aware capture: inject the real bundle into every frame and assemble a
// PageContext, mirroring the extension's frame-aware extraction. Synthetic
// frameIds are assigned in document order (main frame = 0).
async function capturePageContext(page: Page, fixturePath: string) {
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
  await page.waitForTimeout(200);

  const frames: Frame[] = page.frames();
  const inputs: Array<{
    frameId: number;
    parentFrameId?: number;
    origin: string;
    accessible: boolean;
    snapshot?: any;
    unavailableReason?: string;
  }> = [];

  let id = 0;
  for (const frame of frames) {
    const isMain = frame === page.mainFrame();
    const frameId = isMain ? 0 : ++id;
    const parent = frame.parentFrame();
    const parentFrameId = isMain || !parent ? -1 : frames.indexOf(parent) === 0 ? 0 : frames.indexOf(parent);
    try {
      await frame.evaluate(`(function(){${extractScript}})()`);
      const snapshot = await frame.evaluate(
        () => (window as unknown as { __gwaSnapshot?: any }).__gwaSnapshot?.snapshot,
      );
      if (snapshot) {
        inputs.push({
          frameId,
          parentFrameId: isMain ? -1 : parentFrameId,
          origin: new URL(frame.url()).origin,
          accessible: true,
          snapshot,
        });
      } else {
        inputs.push({
          frameId,
          parentFrameId: isMain ? -1 : parentFrameId,
          origin: new URL(frame.url()).origin,
          accessible: false,
          unavailableReason: "cross_origin_unavailable",
        });
      }
    } catch {
      inputs.push({
        frameId,
        parentFrameId: isMain ? -1 : parentFrameId,
        origin: new URL(frame.url()).origin,
        accessible: false,
        unavailableReason: "cross_origin_unavailable",
      });
    }
  }

  return {
    schemaVersion: 1,
    topFrameId: 0,
    frames: inputs.map((i) => ({
      frameId: i.frameId,
      parentFrameId: i.parentFrameId,
      origin: i.origin,
      accessible: i.accessible,
      snapshot: i.snapshot,
      unavailableReason: i.unavailableReason,
    })),
  };
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

test.describe("frame-aware + shadow + relevance extraction (browser)", () => {
  test("discovers a control inside an open shadow root", async ({ page }) => {
    const ctx = await capturePageContext(page, "shadow.html");
    const top = ctx.frames[0];
    expect(top.accessible).toBe(true);
    const names = top.snapshot.elements.map((e: any) => e.accessibleName).join(" ");
    expect(names).toContain("Enviar consulta");
    // The sensitive input inside the shadow root never leaks its value.
    expect(JSON.stringify(ctx)).not.toContain("shadow-secret-1234");
  });

  test("finds a relevant control deep in a long/noisy page", async ({ page }) => {
    const ctx = await capturePageContext(page, "long.html");
    const top = ctx.frames[0];
    const pay = top.snapshot.elements.find((e: any) => e.accessibleName?.toLowerCase().includes("pagar"));
    expect(pay).toBeDefined();
    expect(top.snapshot.elements.length).toBeLessThanOrEqual(200);
  });

  test("represents a same-origin iframe as an independent frame context", async ({ page }) => {
    const ctx = await capturePageContext(page, "iframe.html");
    expect(ctx.frames.length).toBeGreaterThanOrEqual(2);
    const top = ctx.frames[0];
    const child = ctx.frames[1];
    expect(top.origin).toBe(new URL(top.snapshot.page.url).origin);
    // Top frame has its own controls, not the child's.
    expect(top.snapshot.elements.some((e: any) => e.accessibleName?.includes("Pagar"))).toBe(false);
    // Child frame keeps its own context and origin.
    expect(child.accessible).toBe(true);
    expect(child.snapshot.snapshotId).toBeDefined();
    expect(child.snapshot.elements.some((e: any) => e.accessibleName?.includes("Pagar"))).toBe(true);
    // The child snapshot is NOT merged into the top frame.
    expect(ctx.frames[0].snapshot.elements.map((e: any) => e.accessibleName)).not.toContain(
      child.snapshot.elements[0].accessibleName,
    );
  });

  test("combines iframe + shadow and keeps secrets protected", async ({ page }) => {
    const ctx = await capturePageContext(page, "iframe-shadow.html");
    const all = JSON.stringify(ctx);
    expect(all).not.toContain("iframe-shadow-secret-777");
    const names = ctx.frames.flatMap((f: any) => (f.snapshot?.elements ?? []).map((e: any) => e.accessibleName));
    expect(names.join(" ")).toContain("Guardar proyecto");
    expect(names.join(" ")).toContain("Activar notificaciones");
  });
});

test.describe("vertical slice (browser extract -> live backend)", () => {
  test("extracts in browser, posts to the backend, and gets a safe instruction", async ({ page }) => {
    const ctx = await capturePageContext(page, "login.html");
    const res = await page.request.post(`${API_URL}/v1/assist`, {
      data: {
        protocolVersion: 3,
        mode: "DOM_ONLY",
        question: "I don't know what to do here.",
        context: ctx,
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
    const ctx1 = await capturePageContext(page, "login.html");
    const res1 = await page.request.post(`${API_URL}/v1/assist`, {
      data: {
        protocolVersion: 3,
        mode: "DOM_ONLY",
        question: "¿Qué es esta página?",
        context: ctx1,
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
      currentOrigin: ctx1.frames[0].origin,
      turns: [
        { role: "user", text: "¿Qué es esta página?", timestamp: 1 },
        { role: "assistant", text: json1.decision.message, timestamp: 2 },
      ],
    };

    // Second request on a DIFFERENT page (fresh context).
    const ctx2 = await capturePageContext(page, "product.html");
    const res2 = await page.request.post(`${API_URL}/v1/assist`, {
      data: {
        protocolVersion: 3,
        mode: "DOM_ONLY",
        question: "¿Y qué hago ahora?",
        context: ctx2,
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
        webNavigation: {
          getAllFrames: async () => [
            { frameId: 0, parentFrameId: -1, url: "https://mail.google.com/mail" },
          ],
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
    // Wait for the retry to complete (frame capture + backend round-trip).
    await expect(page.locator("#conversation")).toContainText("Pulsa “Recibidos”, a la izquierda.");
    const state = await page.evaluate(() => (window as any).__gwa);
    expect(state.assistCalls).toBe(1);
    expect(state.permissionRequests).toBe(1);
  });
});
