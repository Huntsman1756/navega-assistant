/**
 * Content-script entry, injected on demand into the active tab via
 * chrome.scripting.executeScript after an explicit user action.
 *
 * The manifest does NOT auto-inject this script. Extraction only happens when
 * the user asks for help. It reads the DOM, builds a sanitized snapshot and
 * forwards it to the extension. No values, secrets or provider keys leave this
 * file.
 */
import { extractAccessibleDOMSnapshot } from "@guided-web/accessible-dom";

const snapshot = extractAccessibleDOMSnapshot(document);
void chrome.runtime.sendMessage({ type: "GWA_SNAPSHOT", snapshot });
