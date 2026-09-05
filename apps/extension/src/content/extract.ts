/**
 * Content-script entry, injected on demand into the active tab via
 * chrome.scripting.executeScript after an explicit user action.
 *
 * The manifest does NOT auto-inject this script. Extraction only happens when
 * the user asks for help. It reads the DOM, builds a sanitized snapshot and
 * forwards it inside the extension with a separate local sensitive-value
 * dictionary. The dictionary stays in browser memory; the Side Panel uses it
 * to sanitize the complete outbound request. Provider keys never enter here.
 *
 * A per-capture token is read from the isolated world and echoed back so the
 * side-panel capture can correlate this snapshot to the current tab + capture
 * and ignore a late/stale message from an older injection.
 */
import { extractAccessibleDOMSnapshot, collectSensitiveValues } from "@guided-web/accessible-dom";

const win = globalThis as { __GWA_CAPTURE_TOKEN__?: string };
const captureToken = win.__GWA_CAPTURE_TOKEN__;

try {
  const sensitiveValues = collectSensitiveValues(document);
  const snapshot = extractAccessibleDOMSnapshot(document);
  void chrome.runtime.sendMessage({ type: "GWA_SNAPSHOT", snapshot, captureToken, sensitiveValues });
} catch {
  void chrome.runtime.sendMessage({ type: "GWA_CAPTURE_FAILED", captureToken });
}
