/**
 * Content-script entry, injected on demand into the active tab via
 * chrome.scripting.executeScript after an explicit user action.
 *
 * The manifest does NOT auto-inject this script. Extraction only happens when
 * the user asks for help. It reads the DOM, builds a sanitized snapshot and
 * forwards it to the extension. No values, secrets or provider keys leave this
 * file.
 *
 * A per-capture token is read from the isolated world and echoed back so the
 * side-panel capture can correlate this snapshot to the current tab + capture
 * and ignore a late/stale message from an older injection.
 */
import { extractAccessibleDOMSnapshot } from "@guided-web/accessible-dom";

const win = globalThis as { __GWA_CAPTURE_TOKEN__?: string };
const captureToken = win.__GWA_CAPTURE_TOKEN__;

try {
  const snapshot = extractAccessibleDOMSnapshot(document);
  void chrome.runtime.sendMessage({ type: "GWA_SNAPSHOT", snapshot, captureToken });
} catch {
  // Extraction failed for this frame; the caller represents it as unavailable.
}
