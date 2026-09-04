/**
 * Instruction safety layer.
 *
 * Structured output is NOT a complete safety boundary: even schema-valid
 * messages can ask the user to reveal secrets. This module applies
 * deterministic, auditable checks to model-produced guidance.
 *
 * It is defense in depth, not a substitute for a threat model. Keyword
 * matching cannot fully solve semantic prompt injection; that limitation is
 * documented honestly.
 */

export type SafetyVerdict =
  | { ok: true }
  | { ok: false; reason: string; replacement: string };

const SECRET_TERMS =
  /\b(password|passcode|passphrase|pin|otp|one[- ]?time code|verification code|verification number|security code|recovery code|recovery key|cvv|cvc|ccv|card number|card security|auth(entication)? code|access code|login code|token)\b/i;

const ASK_TO_ME = /\b(tell|send|give|share|provide|type|paste|enter|write|message|dm|post)\b[^.!?]{0,40}\b(me|us|the assistant|here|in the chat|to the assistant|in this chat|in the conversation)\b/i;

const ASK_TO_ME_INVERTED = /\b(me|us|the assistant)\b[^.!?]{0,40}\b(need|want|require|ask for|request)\b[^.!?]{0,40}\b(password|code|pin|otp|cvv|cvc|recovery|verification|token)\b/i;

const ASK_WHAT_IS = /\bwhat is (your|the) (password|pin|code|otp|cvv|cvc|recovery|verification|token)\b/i;

const SECRET_TO_ME_PHRASE =
  /\b(disclose|reveal|share|send|give|tell|provide)\b[^.!?]{0,30}\b(me|us|the assistant)\b[^.!?]{0,30}\b(password|code|pin|otp|cvv|cvc|recovery|verification|token)\b/i;

const ES_SECRET_TERMS =
  /\b(contraseña|clave|código|pin|otp|cvv|cvc|tarjeta|seguridad|recuperación|verificación)\b/i;

const ES_ASK_TO_ME =
  /\b(dime|env[íi]ame|m[áa]ndame|dame|comp[áa]rteme|p[áa]same|escríbeme|facilítame|indícame)\b[^.!?]{0,50}\b(tu|la|el)\b[^.!?]{0,30}\b(contraseña|clave|código|pin|cvv|cvc|tarjeta)\b/i;

const ES_ASK_WHAT_IS =
  /\b(cu[áa]l es|cu[áa]l es tu|¿cu[áa]l)\b[^.!?]{0,20}\b(contraseña|clave|código|pin|cvv|cvc|tarjeta)\b/i;

const ES_SECRET_TO_ME =
  /\b(dime|env[íi]ame|m[áa]ndame|dame|comp[áa]rteme)\b[^.!?]{0,30}\b(contraseña|clave|código|pin|cvv|cvc|tarjeta)\b/i;

function looksLikeSecretRequest(message: string): string | null {
  const lower = message.toLowerCase();

  if (ASK_WHAT_IS.test(lower)) {
    return "message asks the user to disclose a secret credential";
  }
  if (ASK_TO_ME.test(lower) && SECRET_TERMS.test(lower)) {
    return "message instructs the user to send a secret credential to the assistant";
  }
  if (ASK_TO_ME_INVERTED.test(lower)) {
    return "message requests a secret credential from the user";
  }
  if (SECRET_TO_ME_PHRASE.test(lower)) {
    return "message asks the user to disclose a secret credential";
  }
  if (ES_ASK_WHAT_IS.test(lower)) {
    return "message asks the user to disclose a secret credential (es)";
  }
  if (ES_ASK_TO_ME.test(lower) && ES_SECRET_TERMS.test(lower)) {
    return "message instructs the user to send a secret credential to the assistant (es)";
  }
  if (ES_SECRET_TO_ME.test(lower)) {
    return "message asks the user to disclose a secret credential (es)";
  }
  return null;
}

const SAFE_REPLACEMENT =
  "Si este campo pide una contraseña, un código o un número de tarjeta, escríbelo directamente en el sitio web. Nunca me digas tu contraseña ni ningún código.";

/** Blocks or replaces messages that ask the user to reveal secrets. */
export function checkInstructionSafety(message: string): SafetyVerdict {
  const reason = looksLikeSecretRequest(message);
  if (reason) {
    return { ok: false, reason, replacement: SAFE_REPLACEMENT };
  }
  return { ok: true };
}

export interface SimplicityVerdict {
  ok: boolean;
  wordCount: number;
  issues: string[];
}

const MAX_WORDS = 80;
const IMPERATIVE_COUNT_RE = /(?:\bpress\b|\bclick\b|\benter\b|\btype\b|\bselect\b|\bgo to\b|\bchoose\b|\btap\b|\bopen\b|\bclose\b|\bscroll\b)/gi;

/** Soft guidance-quality check; never blocks, only reports. */
export function checkConversationSimplicity(message: string): SimplicityVerdict {
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  const issues: string[] = [];

  if (words > MAX_WORDS) {
    issues.push(`message exceeds ${MAX_WORDS} words`);
  }

  const imperatives = message.match(IMPERATIVE_COUNT_RE) ?? [];
  if (imperatives.length > 1) {
    issues.push("message contains multiple imperatives");
  }

  return { ok: issues.length === 0, wordCount: words, issues };
}
