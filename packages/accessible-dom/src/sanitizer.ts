/**
 * Local sanitization rules.
 *
 * The extension MUST sanitize before any data leaves the browser. We never
 * serialize input values. This module classifies sensitive fields and decides
 * which elements may be excluded entirely.
 *
 * This is defense in depth and data minimization, not a promise of perfect
 * privacy.
 */
export type SecretFieldKind = "password" | "otp" | "card" | "none";

/** Heuristically classify a form control as a secret-bearing field. */
export function classifySecretField(el: Element): SecretFieldKind {
  const type = (el.getAttribute("type") || "").toLowerCase();
  const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
  const name = (el.getAttribute("name") || "").toLowerCase();
  const id = (el.getAttribute("id") || "").toLowerCase();
  const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
  const combined = `${name} ${id} ${placeholder}`;

  if (type === "password") return "password";
  if (autocomplete.includes("one-time-code") || autocomplete.includes("otp")) return "otp";
  if (autocomplete.includes("cc-csc") || autocomplete.includes("cc-cvv")) return "card";
  if (autocomplete.includes("cc-number") || autocomplete.includes("cc-exp")) return "card";
  if (/\b(otp|one[- ]?time|token|secret|pin|cvv|cvc|ccv|card|pan|cardnumber)\b/.test(combined)) {
    return "otp";
  }
  return "none";
}

/**
 * Elements that must never be part of the serialized snapshot. Hidden inputs
 * are excluded entirely because their values can carry session tokens/secrets.
 */
export function shouldExcludeElement(el: Element): boolean {
  if (el instanceof HTMLInputElement && el.type === "hidden") return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.closest("script, style, noscript, template")) return true;
  return false;
}

/** Returns true when an element is visually hidden (approximate, conservative). */
export function isHidden(el: Element): boolean {
  const anyEl = el as HTMLElement;
  if (anyEl.hidden) return true;
  const style = anyEl.style;
  if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  if (anyEl.getAttribute("aria-hidden") === "true") return true;
  const parent = anyEl.parentElement;
  if (parent && parent !== anyEl) {
    const pStyle = (parent as HTMLElement).style;
    if (pStyle && (pStyle.display === "none" || pStyle.visibility === "hidden")) return true;
  }
  return false;
}

/**
 * Extra defensive redaction applied to the *accessible name* of a classified
 * secret field. Accessible-name calculation never reads an input's live value,
 * but we still strip digit runs that could look like a card/OTP/verification
 * code so no plausible secret can slip through as a name or placeholder. This
 * is layered on top of the fact that the sanitizer is the authoritative
 * boundary and the snapshot schema does not even allow a `value` field.
 */
export function redactSensitiveRuns(text: string, kind: SecretFieldKind): string {
  if (!text) return text;
  if (kind === "card") {
    return text
      .replace(/\b\d{13,19}\b/g, "[redactado]")
      .replace(/\b\d{4}([ -]?\d{4}){2,}\b/g, "[redactado]");
  }
  if (kind === "otp" || kind === "password") {
    return text.replace(/\b\d{4,8}\b/g, "[redactado]");
  }
  return text;
}
