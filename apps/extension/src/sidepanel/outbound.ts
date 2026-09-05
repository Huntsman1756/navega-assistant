import { AssistRequestSchema, type HelpSession, type PageContext } from "@guided-web/protocol";
import { boundContext, sanitizeStrings } from "@guided-web/accessible-dom";
import { redactSecretValues } from "@guided-web/security-policy";

// Browser memory only; neither JSON-serializable nor checkpointed.
const dictionaries = new WeakMap<PageContext, readonly string[]>();
export function rememberCaptureSecrets(context: PageContext, values: readonly string[]): void {
  dictionaries.set(context, values);
}

export function sanitizeOutbound(context: PageContext, question: string, session: HelpSession) {
  const values = dictionaries.get(context) ?? [];
  const raw = { protocolVersion: 3, mode: "DOM_ONLY", context, question, session };
  const heuristic = JSON.parse(JSON.stringify(raw, (_key, value: unknown) => typeof value === "string" ? redactSecretValues(value) : value));
  const clean = sanitizeStrings(heuristic, values);
  clean.question = clean.question.trim();
  clean.context = boundContext(clean.context);
  const payload = AssistRequestSchema.parse(clean);
  const serialized = JSON.stringify(payload);
  // Fail closed if a value also occurs in structural keys or normalized output.
  if (values.some(value => value && (serialized.includes(value) || serialized.includes(JSON.stringify(value).slice(1, -1))))) {
    throw new Error("outbound privacy check failed");
  }
  return payload;
}

export function sanitizeCapturedData<T>(context: PageContext, value: T): T {
  return sanitizeStrings(value, dictionaries.get(context) ?? []);
}
