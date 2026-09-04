/**
 * Pure permission / page-access helpers.
 *
 * These are chrome-free so they can be unit-tested. They decide whether a page
 * is reachable at all (http/https), whether it is a browser-protected page that
 * we must never try to inject into, and how to build the match pattern used by
 * chrome.permissions for a given origin.
 *
 * The extension NEVER requests broad permanent access. It relies on `activeTab`
 * first, and only asks the user to grant access to the specific origin when
 * Chrome cannot reach the page.
 */

/**
 * Browser-internal schemes we must never attempt to inject into. Any http/https
 * page outside the listed protected hosts is reachable; other schemes fall back
 * to "unsupported" and are never injected into either.
 */
export const PROTECTED_SCHEMES = [
  "chrome:",
  "chrome-extension:",
  "chrome-untrusted:",
  "edge:",
  "edge-extension:",
  "devtools:",
  "about:",
  "view-source:",
] as const;

/** Browser-protected store hosts that must not be accessed. */
const PROTECTED_HOSTS = new Set([
  "chromewebstore.google.com",
  "chrome.google.com",
  "clients2.google.com",
]);

export type PageAccessKind = "supported" | "protected" | "unsupported";

/**
 * Classify a URL. `protected` means a browser-internal/store page that must
 * never be injected into. `unsupported` means a scheme we do not support
 * (file:, data:, etc.). `supported` is any http/https page.
 */
export function classifyPage(url: string): PageAccessKind {
  if (!url) return "unsupported";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "unsupported";
  }
  const scheme = parsed.protocol;
  if (PROTECTED_SCHEMES.includes(scheme as (typeof PROTECTED_SCHEMES)[number])) {
    return "protected";
  }
  const host = parsed.hostname.toLowerCase();
  if (PROTECTED_HOSTS.has(host)) return "protected";
  if (scheme === "http:" || scheme === "https:") return "supported";
  return "unsupported";
}

/**
 * Build the Chrome host match pattern for a URL. Ports are intentionally
 * omitted because host-permission match patterns match by origin (any port).
 */
export function originMatchPattern(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

/** Human-readable origin used in the permission prompt. */
export function displayOrigin(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
