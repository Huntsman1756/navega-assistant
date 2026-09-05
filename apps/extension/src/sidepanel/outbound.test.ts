// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { collectSensitiveValues, extractAccessibleDOMSnapshot, buildPageContext } from "@guided-web/accessible-dom";
import { HelpSessionSchema } from "@guided-web/protocol";
import { rememberCaptureSecrets, sanitizeOutbound } from "./outbound";
import { requestAssist } from "../service-worker/logic";
import { createApp } from "../../../api/src/routes";
import { OpenAICompatibleProvider } from "../../../../packages/provider/src/openai-compatible-provider";

it("removes classified markers across DOM/question/session from the COMPLETE provider HTTP payload", async () => {
  const markers = ['SECRET_PASSWORD_X91', 'SECRET_OTP_938271', 'SECRET_RECOVERY_XYZ', 'SECRET_API_KEY_X92'];
  document.body.innerHTML = `<input type="password" value="${markers[0]}"><input id="otp" autocomplete="one-time-code" value="${markers[1]}"><button aria-labelledby="otp">Continue</button><h1>${markers[0]}</h1><label>${markers[1]}</label><textarea name="recovery-code">${markers[2]}</textarea><input name="api_key" value="${markers[3]}"><button>Valid CTA</button>`;
  document.title = markers.join(' ');
  const values = collectSensitiveValues(document);
  expect(values).toHaveLength(4);
  const snapshot = extractAccessibleDOMSnapshot(document);
  snapshot.page.url = 'https://example.com/path?query=SECRET_QUERY_X93#SECRET_FRAGMENT_X94';
  const context = buildPageContext(0, [{ frameId: 0, accessible: true, snapshot }]);
  rememberCaptureSecrets(context, values);
  const payload = sanitizeOutbound(context, 'Help with ' + markers.join(' '), HelpSessionSchema.parse({ schemaVersion: 1, sessionId: 'safe-session', goal: 'Goal ' + markers[2], turns: [{ role: 'user', text: 'Previous ' + markers[0], timestamp: 1 }, { role: 'assistant', text: 'Echo ' + markers[1], timestamp: 2 }] }));
  let providerBody = '';
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    providerBody = String(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: 'explain', message: 'Use Valid CTA' }) } }] }), { status: 200 });
  }));
  try {
    const app = createApp(new OpenAICompatibleProvider({ baseUrl: 'https://provider.invalid/v1', apiKey: 'synthetic-only', model: 'qwen3.6' }), 'openai-compatible', 'qwen3.6');
    const result = await requestAssist('http://localhost:8787', payload.context, payload.question, payload.session, async (_url, init) => app.request('/v1/assist', init));
    expect(result.ok).toBe(true);
    expect(providerBody).toContain('Valid CTA');
    expect(providerBody).toContain('qwen3.6');
    for (const marker of [...markers, 'SECRET_QUERY_X93', 'SECRET_FRAGMENT_X94']) expect(providerBody.includes(marker)).toBe(false);
    expect(providerBody.includes('sensitiveValues')).toBe(false);
    expect(JSON.stringify(payload).includes('SECRET_')).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
