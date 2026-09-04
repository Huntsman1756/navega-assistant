/**
 * Manifest V3 service worker.
 *
 * Treated as ephemeral. No long-lived state lives here. It is a routing/boundary
 * layer: it opens the side panel and forwards sanitized assist requests to the
 * self-hostable backend. Provider credentials never live in the extension.
 */
import type { AssistMessage, AssistResultMessage } from "../shared/messages";

const DEFAULT_BACKEND_URL = "http://localhost:8787";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // best effort; the action is the primary entry point
    });
});

async function getBackendUrl(): Promise<string> {
  const stored = await chrome.storage.local.get("backendUrl");
  const value = stored.backendUrl;
  return typeof value === "string" && value.length > 0 ? value : DEFAULT_BACKEND_URL;
}

async function handleAssist(msg: AssistMessage): Promise<AssistResultMessage> {
  const baseUrl = await getBackendUrl();
  try {
    const res = await fetch(`${baseUrl}/v1/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 1,
        mode: "DOM_ONLY",
        question: msg.question,
        snapshot: msg.snapshot,
      }),
    });

    const data = (await res.json().catch(() => null)) as
      | { error?: string; decision?: unknown }
      | null;

    if (!res.ok || !data || !data.decision) {
      return { type: "GWA_ASSIST_RESULT", ok: false, error: data?.error ?? "backend_error" };
    }

    return { type: "GWA_ASSIST_RESULT", ok: true, decision: data.decision as never };
  } catch {
    return { type: "GWA_ASSIST_RESULT", ok: false, error: "network" };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as Partial<AssistMessage> | undefined;
  if (msg?.type === "GWA_ASSIST") {
    void handleAssist(msg as AssistMessage).then((result) => sendResponse(result));
    return true;
  }
  return undefined;
});
