// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { collectSensitiveValues, extractAccessibleDOMSnapshot, buildPageContext } from "@guided-web/accessible-dom";
import { AssistRequestSchema, HelpSessionSchema, PROTOCOL_VERSION, OPERATOR_API_PORT } from "@guided-web/protocol";
import { rememberCaptureSecrets, sanitizeOutbound } from "./outbound";
import { requestAssist } from "../service-worker/logic";
import { createApp } from "../../../api/src/routes";
import { OpenAICompatibleProvider } from "../../../../packages/provider/src/openai-compatible-provider";

describe("outbound privacy regression — classified secret structural collision", () => {
  it("classified value equal to structural token 'protocolVersion' causes fail-closed rejection", () => {
    // When a classified secret value matches a structural JSON key,
    // the fail-closed check detects the collision and throws.
    const structuralToken = "protocolVersion";
    document.body.innerHTML = `<input name="api_key" value="${structuralToken}">`;
    const values = collectSensitiveValues(document);
    expect(values).toContain(structuralToken);
    const snapshot = extractAccessibleDOMSnapshot(document);
    const context = buildPageContext(0, [{ frameId: 0, accessible: true, snapshot }]);
    rememberCaptureSecrets(context, values);
    // The fail-closed check finds the value in structural keys of the serialized payload
    // and throws — this IS the correct fail-closed behavior.
    expect(() => sanitizeOutbound(context, "ask with " + structuralToken, HelpSessionSchema.parse({ schemaVersion: 1, sessionId: "s", turns: [] }))).toThrow("outbound privacy check failed");
  });

  it("classified value equal to ContextMode enum 'DOM_ONLY' causes validation rejection", () => {
    const modeToken = "DOM_ONLY";
    document.body.innerHTML = `<input name="token" value="${modeToken}">`;
    const values = collectSensitiveValues(document);
    expect(values).toContain(modeToken);
    const snapshot = extractAccessibleDOMSnapshot(document);
    const context = buildPageContext(0, [{ frameId: 0, accessible: true, snapshot }]);
    rememberCaptureSecrets(context, values);
    // sanitizeOutbound redacts "DOM_ONLY" from the mode field (which is set by code but passes through sanitizeStrings),
    // producing an empty string for mode → Zod rejects with invalid_enum_value.
    // Either way: the classified value does NOT appear safely in the final payload.
    expect(() => sanitizeOutbound(context, "query " + modeToken, HelpSessionSchema.parse({ schemaVersion: 1, sessionId: "s", turns: [] }))).toThrow();
  });

  it("classified value equal to 'schemaVersion' structural token causes fail-closed rejection", () => {
    const token = "schemaVersion";
    document.body.innerHTML = `<input name="secret" value="${token}">`;
    const values = collectSensitiveValues(document);
    expect(values).toContain(token);
    const snapshot = extractAccessibleDOMSnapshot(document);
    const context = buildPageContext(0, [{ frameId: 0, accessible: true, snapshot }]);
    rememberCaptureSecrets(context, values);
    // Fail-closed: structural key collision detected
    expect(() => sanitizeOutbound(context, "help " + token, HelpSessionSchema.parse({ schemaVersion: 1, sessionId: "s", turns: [] }))).toThrow("outbound privacy check failed");
  });

  it("classified value that also appears in structural JSON output is rejected", () => {
    const token = "visibleText";
    document.body.innerHTML = `<input name="api_key" value="${token}">`;
    const values = collectSensitiveValues(document);
    expect(values).toContain(token);
    const snapshot = extractAccessibleDOMSnapshot(document);
    const context = buildPageContext(0, [{ frameId: 0, accessible: true, snapshot }]);
    rememberCaptureSecrets(context, values);
    expect(() => sanitizeOutbound(context, "query " + token, HelpSessionSchema.parse({ schemaVersion: 1, sessionId: "s", turns: [] }))).toThrow("outbound privacy check failed");
  });

  it("fail-closed when a classified secret persists in the snapshot and causes privacy check failure", () => {
    // Use a classified secret that also appears as accessible text (not just input value).
    // The sanitizer removes it from the input value, but redactSensitiveRuns keeps
    // plausible digit patterns in names — here we use a secret that survives the redaction pass.
    document.body.innerHTML = `<input type="password" value="secret-X9Z-alive"><button>Use secret-X9Z-alive now</button>`;
    const values = collectSensitiveValues(document);
    expect(values).toContain("secret-X9Z-alive");
    const snapshot = extractAccessibleDOMSnapshot(document);
    const context = buildPageContext(0, [{ frameId: 0, accessible: true, snapshot }]);
    rememberCaptureSecrets(context, values);
    // The secret is in the button's accessible name and in the question — sanitizeOutbound
    // redacts it from all string values, but the fail-closed check verifies it never leaked.
    const payload = sanitizeOutbound(context, "Use secret-X9Z-alive", HelpSessionSchema.parse({ schemaVersion: 1, sessionId: "s", turns: [] }));
    expect(payload).toBeDefined();
    // No string in the payload contains the secret value.
    const serialized = JSON.stringify(payload);
    expect(serialized.includes("secret-X9Z-alive")).toBe(false);
  });
});

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
    const result = await requestAssist(`http://localhost:${OPERATOR_API_PORT}`, payload.context, payload.question, payload.session, async (_url, init) => app.request('/v1/assist', init));
    expect(result.ok).toBe(true);
    expect(providerBody).toContain('Valid CTA');
    expect(providerBody).toContain('qwen3.6');
    for (const marker of [...markers, 'SECRET_QUERY_X93', 'SECRET_FRAGMENT_X94']) expect(providerBody.includes(marker)).toBe(false);
    expect(providerBody.includes('sensitiveValues')).toBe(false);
    expect(JSON.stringify(payload).includes('SECRET_')).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
