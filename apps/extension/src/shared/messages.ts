/**
 * Message protocol between the content script, service worker and side panel.
 *
 * These are P0-internal extension messages. They carry sanitized snapshots
 * only; they never carry secrets or provider keys.
 */
import type { AccessibleDOMSnapshot, P0AssistantDecision } from "@guided-web/protocol";

export interface SnapshotMessage {
  type: "GWA_SNAPSHOT";
  snapshot: AccessibleDOMSnapshot;
}

export interface AssistMessage {
  type: "GWA_ASSIST";
  snapshot: AccessibleDOMSnapshot;
  question: string;
}

export type AssistResultMessage =
  | { type: "GWA_ASSIST_RESULT"; ok: true; decision: P0AssistantDecision }
  | { type: "GWA_ASSIST_RESULT"; ok: false; error: string };
