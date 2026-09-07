/**
 * Manifest V3 service worker.
 *
 * Treated as ephemeral. No long-lived state lives here. It is a routing/boundary
 * layer: it opens the side panel and forwards sanitized assist requests to the
 * self-hostable backend. Provider credentials never live in the extension.
 */
import { requestAssist } from "./logic";
import { OPERATOR_API_PORT } from "@guided-web/protocol";
import type { AssistMessage, AssistResultMessage, CancelAssistMessage } from "../shared/messages";

const activeAssistControllers = new Map<string, AbortController>();

const DEFAULT_BACKEND_URL = `http://localhost:${OPERATOR_API_PORT}`;

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
  const controller = new AbortController();
  const requestId = msg.requestId;
  if (requestId) activeAssistControllers.set(requestId, controller);
  try {
    const baseUrl = await getBackendUrl();
    return await requestAssist(
      baseUrl,
      msg.context,
      msg.question,
      msg.session,
      fetch,
      undefined,
      controller.signal,
    );
  } finally {
    if (requestId && activeAssistControllers.get(requestId) === controller) {
      activeAssistControllers.delete(requestId);
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as Partial<AssistMessage> | undefined;
  if (msg?.type === "GWA_ASSIST" && _sender.url === chrome.runtime.getURL("sidepanel/index.html")) {
    void handleAssist(msg as AssistMessage).then((result) => sendResponse(result));
    return true;
  }
  const cancel = message as Partial<CancelAssistMessage> | undefined;
  if (cancel?.type === "GWA_CANCEL_ASSIST" && _sender.url === chrome.runtime.getURL("sidepanel/index.html")) {
    if (typeof cancel.requestId === "string") activeAssistControllers.get(cancel.requestId)?.abort();
    sendResponse({ ok: true });
    return false;
  }
  return undefined;
});
