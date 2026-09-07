/**
 * Message protocol between the content script, service worker and side panel.
 *
 * These are P0-internal extension messages. They carry sanitized snapshots
 * only; they never carry secrets or provider keys.
 */
import type { AccessibleDOMSnapshot, HelpSession, P0AssistantDecision, PageContext } from "@guided-web/protocol";

/** A single frame's sanitized snapshot, sent by the content script. */
export interface SnapshotMessage {
  type: "GWA_SNAPSHOT";
  snapshot: AccessibleDOMSnapshot;
}

export interface AssistMessage {
  type: "GWA_ASSIST";
  context: PageContext;
  question: string;
  session: HelpSession;
  /** Opaque operation id used only to cancel a stale side-panel request. */
  requestId?: string;
}

export interface CancelAssistMessage {
  type: "GWA_CANCEL_ASSIST";
  requestId: string;
}

export type AssistResultMessage =
  | { type: "GWA_ASSIST_RESULT"; ok: true; decision: P0AssistantDecision }
  | { type: "GWA_ASSIST_RESULT"; ok: false; error: string };
