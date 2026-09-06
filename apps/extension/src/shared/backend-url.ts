/**
 * Shared backend URL resolution for the extension.
 *
 * Mirrors the authoritative policy used in the service worker so that voice
 * requests, normal assist requests, and dictation fallback all target the
 * same configured backend.
 *
 * Policy:
 *   1. Check chrome.storage.local["backendUrl"]
 *   2. Fall back to http://localhost:OPERATOR_API_PORT (8787)
 *
 * No second configuration mechanism. No hardcoded ports in voice code.
 */
import { OPERATOR_API_PORT } from "@guided-web/protocol";

const DEFAULT_BACKEND_URL = `http://localhost:${OPERATOR_API_PORT}`;

/**
 * Resolve the authoritative backend base URL (e.g. "http://localhost:8787").
 *
 * This must NOT be called from the service worker — the service worker has
 * its own implementation to avoid circular dependencies. The extension side
 * panel and voice modules should use this function instead of hardcoding.
 *
 * Returns a Promise because chrome.storage queries are async.
 */
export async function getBackendUrl(): Promise<string> {
  try {
    const stored = await chrome.storage.local.get("backendUrl");
    const value = stored.backendUrl;
    if (typeof value === "string" && value.length > 0) {
      // Trim trailing slashes so path joining is safe.
      return value.replace(/\/+$/, "");
    }
  } catch {
    // Best-effort; fall through to default.
  }
  return DEFAULT_BACKEND_URL;
}