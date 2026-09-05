/**
 * Local sanitization rules.
 *
 * The extension MUST sanitize before data leaves the browser. This module
 * classifies sensitive controls, collects their values locally, and removes
 * exact matches across outbound strings. No value property enters a snapshot.
 *
 * This is a GUARANTEE for classified captured values and a defence-in-depth (statistical,
 * conservatively-gated) layer for secret-looking visible text. See
 * `docs/SECURITY-INVARIANTS.md` P0-07 for the exact, auditable contract.
 */
import { iterElements } from "./traversal";

export type SecretFieldKind = "password" | "otp" | "card" | "secret" | "none";

/** Heuristically classify a form control as a secret-bearing field. */
export function classifySecretField(el: Element): SecretFieldKind {
  const type = (el.getAttribute("type") || "").toLowerCase();
  const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
  const name = (el.getAttribute("name") || "").toLowerCase();
  const id = (el.getAttribute("id") || "").toLowerCase();
  const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
  const labels = (el as HTMLInputElement).labels;
  const label = [el.getAttribute("aria-label") || "", ...Array.from(labels ?? [], l => l.textContent || "")].join(" ");
  const combined = `${name} ${id} ${placeholder} ${label}`.replace(/[_-]/g, " ").toLowerCase();
  if (/api\s*key|secret|token|recovery|backup\s*code|password|contrase[\u00f1n]a/.test(combined)) return "secret";

  if (autocomplete.includes("password")) return "password";
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
 * secret field. Accessible-name calculation can indirectly read live values,
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

/**
 * High-confidence visible-text secret redaction (defence in depth).
 *
 * A secret may appear as ordinary page text rather than an input value, e.g.
 * “Tu código de verificación es 938271”. This redacts the code ONLY when it is
 * immediately preceded by a strong, unambiguous secret context phrase
 * (verification code, OTP, recovery code, one-time code, etc.). It deliberately
 * does NOT redact arbitrary 4–8 digit runs: a date, price, postal code, order
 * number or article number must not disappear merely because it contains
 * digits.
 *
 * Guaranteed protections (raw input values) live in `classifySecretField` /
 * `shouldExcludeElement` / the never-serialize-a-value property of the
 * snapshot schema. This function is a conservative SECOND layer.
 */
const SENSITIVE_CODE_CONTEXT =
  /\b(?:verification code|verification number|código de verificación|número de verificación|one[- ]?time code|one[- ]?time password|código de un solo uso|otp|recovery code|código de recuperación|security code|código de seguridad|authentication code|código de autenticación|access code|código de acceso)\b/i;

export function redactSensitiveVisibleText(text: string): string {
  if (!text) return text;
  let changed = false;
  const out = text.replace(
    new RegExp(
      `(${SENSITIVE_CODE_CONTEXT.source})[^.!?\\n]{0,28}?\\b(\\d{4,8})\\b`,
      "gi",
    ),
    (match, _phrase: string, code: string) => {
      changed = true;
      return match.replace(code, "[redactado]");
    },
  );
  return changed ? out : text;
}

/** Local-only dictionary: never attach it to wire schemas or storage. */
export function collectSensitiveValues(root: Document | ShadowRoot): string[] {
  const values = new Set<string>();
  let characters = 0;
  for (const el of iterElements(root)) {
    if (!['input', 'textarea', 'select'].includes(el.localName)) continue;
    if (classifySecretField(el) === 'none' && el.getAttribute('type') !== 'hidden') continue;
    const value = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    if (!value || values.has(value)) continue;
    values.add(value);
    characters += value.length;
    if (values.size > 2000 || characters > 64000) throw new Error('privacy collection budget exceeded');
  }
  return [...values];
}

/** Every string value, using exact literal matching rather than secret-pattern regexes. */
export function sanitizeStrings<T>(value: T, sensitiveValues: readonly string[]): T {
  const secrets = [...new Set(sensitiveValues.filter(Boolean))].sort((a,b) => b.length - a.length);
  const clean = (text: string): string => {
    let out = redactSensitiveVisibleText(text);
    let previous: string;
    do {
      previous = out;
      for (const secret of secrets) out = out.split(secret).join('');
    } while (out !== previous);
    return out;
  };
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'string' ? clean(item) : item)) as T;
}
