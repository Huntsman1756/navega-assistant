import { Hono } from "hono";
import type { AIProvider } from "@guided-web/provider";
import {
  AssistRequestSchema,
  P0AssistantDecisionSchema,
  PROTOCOL_VERSION,
} from "@guided-web/protocol";
import { checkInstructionSafety, checkConversationSimplicity } from "@guided-web/security-policy";
import { buildSystemPrompt } from "./prompt";

/**
 * Builds the backend HTTP app.
 *
 * Pipeline per request:
 *   raw request -> strict schema validation -> provider call -> JSON parse ->
 *   strict decision validation -> instruction safety checks -> simplicity
 *   checks -> response.
 */
export function createApp(provider: AIProvider, providerName: string, model?: string): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, provider: providerName }));

  app.post("/v1/assist", async (c) => {
    const body = await c.req.json().catch(() => null);

    const parsed = AssistRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", details: parsed.error.flatten() },
        400,
      );
    }
    const req = parsed.data;

    let response;
    try {
      response = await provider.assist({
        mode: req.mode,
        question: req.question,
        session: req.session,
        snapshot: req.snapshot,
        systemPrompt: buildSystemPrompt(),
      });
    } catch (err) {
      return c.json({ error: "provider_unavailable", message: String(err) }, 502);
    }

    let rawDecision: unknown;
    try {
      rawDecision = JSON.parse(response.raw);
    } catch {
      return c.json({ error: "invalid_model_output", reason: "not_json" }, 502);
    }

    const decisionParsed = P0AssistantDecisionSchema.safeParse(rawDecision);
    if (!decisionParsed.success) {
      return c.json({ error: "invalid_model_output", reason: "schema" }, 502);
    }
    const decision = decisionParsed.data;

    const safety = checkInstructionSafety(decision.message);
    const message = safety.ok ? decision.message : safety.replacement;

    const simplicity = checkConversationSimplicity(message);
    if (!simplicity.ok) {
      // P0: report only, never block. Documented as a soft gate.
      console.warn("[simplicity]", simplicity.issues.join("; "));
    }

    const out =
      decision.kind === "cannot_help"
        ? { ...decision, message }
        : { ...decision, message };

    return c.json({
      protocolVersion: PROTOCOL_VERSION,
      decision: out,
      mode: req.mode,
      provider: response.provider,
      model: response.model ?? model,
    });
  });

  return app;
}
