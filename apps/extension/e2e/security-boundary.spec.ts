import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildPageContext } from "@guided-web/accessible-dom";
import type { AccessibleDOMSnapshot } from "@guided-web/protocol";
import { rememberCaptureSecrets, sanitizeOutbound } from "../src/sidepanel/outbound";
import { requestAssist } from "../src/service-worker/logic";
import { createApp } from "../../api/src/routes";
import { OpenAICompatibleProvider } from "../../../packages/provider/src/openai-compatible-provider";

test("built extractor + real browser DOM through complete provider serialization excludes all markers", async ({ page }) => {
  const bundle = readFileSync(new URL("../dist/content/extract.js", import.meta.url), "utf8");
  await page.addInitScript(() => {
    Object.assign(window, { chrome: { runtime: { sendMessage: (msg: unknown) => Object.assign(window, { captured: msg }) } } });
  });
  await page.goto('/security-boundary.html?SECRET_QUERY_X93#SECRET_FRAGMENT_X94');
  await page.evaluate(bundle);
  const captured = await page.evaluate(() => (window as unknown as { captured: { snapshot: AccessibleDOMSnapshot; sensitiveValues: string[] } }).captured);
  expect(captured.sensitiveValues).toHaveLength(4);
  const context = buildPageContext(0, [{ frameId: 0, accessible: true, snapshot: captured.snapshot }]);
  rememberCaptureSecrets(context, captured.sensitiveValues);
  const markers = ['SECRET_PASSWORD_X91', 'SECRET_OTP_938271', 'SECRET_RECOVERY_XYZ', 'SECRET_API_KEY_X92'];
  const payload = sanitizeOutbound(context, 'Help ' + markers.join(' '), { schemaVersion: 1, sessionId: 'safe', goal: 'Goal ' + markers[0], turns: [{ role: 'user', text: 'Previous ' + markers[1], timestamp: 1 }, { role: 'assistant', text: 'Echo ' + markers[2], timestamp: 2 }] });
  const originalFetch = globalThis.fetch;
  let serialized = '';
  globalThis.fetch = async (_url, init) => {
    serialized = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: 'explain', message: 'Use Valid CTA' }) } }] }));
  };
  try {
    const app = createApp(new OpenAICompatibleProvider({ baseUrl: 'https://provider.invalid/v1', apiKey: 'synthetic-only', model: 'qwen3.6' }), 'openai-compatible', 'qwen3.6');
    expect((await requestAssist('http://localhost:8787', payload.context, payload.question, payload.session, async (_url, init) => app.request('/v1/assist', init))).ok).toBe(true);
    expect(serialized.includes('Valid CTA')).toBe(true);
    for (const marker of [...markers, 'SECRET_QUERY_X93', 'SECRET_FRAGMENT_X94']) expect(serialized.includes(marker)).toBe(false);
  } finally { globalThis.fetch = originalFetch; }
});
