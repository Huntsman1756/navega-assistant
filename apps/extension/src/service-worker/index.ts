/**
 * Manifest V3 service worker.
 *
 * Treated as ephemeral. No long-lived state lives here. It is a routing/boundary
 * layer: it opens the side panel and forwards sanitized assist requests to the
 * self-hostable backend. Provider credentials never live in the extension.
 */
import { requestAssist } from "./logic";
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
  return requestAssist(baseUrl, msg.context, msg.question, msg.session);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as Partial<AssistMessage> | undefined;
  if (msg?.type === "GWA_ASSIST" && _sender.url === chrome.runtime.getURL("sidepanel/index.html")) {
    void handleAssist(msg as AssistMessage).then((result) => sendResponse(result));
    return true;
  }
  return undefined;
});
