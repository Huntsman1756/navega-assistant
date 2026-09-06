/**
 * Message types for the voice transcription transport between
 * the dictation page and the side panel.
 *
 * Adapted from the Hermes Browser Extension transcript-transport pattern:
 * dual-channel delivery (chrome.runtime.sendMessage + chrome.storage.session
 * fallback), short TTL, consume-once, immediate delete.
 *
 * Upstream: Hermes Browser Extension (MIT) -- commit 64f2abe443dddee78313e3b18169474cbd0f4f95
 * Files: extension/sidepanel.js (lines 3718-4307), extension/voice-dictation.js
 */

export const VOICE_TRANSCRIPT_TTL_MS = 30000;

export interface VoiceTranscriptMessage {
  type: "VOICE_TRANSCRIPT";
  text: string;
  ts: number;
}

export interface VoiceTranscriptRequest {
  type: "VOICE_TRANSCRIPT_REQUEST";
  requestId: string;
}

export interface VoiceTranscriptResponse {
  type: "VOICE_TRANSCRIPT_RESPONSE";
  requestId: string;
  text: string;
  ts: number;
}

/**
 * Attempt to deliver a transcript to the side panel via
 * chrome.runtime.sendMessage. Returns true on success, false if the
 * target page is not listening.
 */
export function trySendMessage(message: VoiceTranscriptMessage): boolean {
  try {
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        // No listener -- fall through to storage fallback
      }
    });
    return !chrome.runtime.lastError;
  } catch {
    return false;
  }
}

/**
 * Store a transcript in chrome.storage.session as fallback delivery.
 * The key includes a timestamp for uniqueness. TTL = VOICE_TRANSCRIPT_TTL_MS.
 */
export async function storeTranscriptFallback(
  text: string,
  ts: number,
): Promise<void> {
  const key = `_nav_voice_transcript_${Date.now()}`;
  await chrome.storage.session.set({
    [key]: { text, ts, createdAt: Date.now() },
  });
}

/**
 * Check if a transcript is still fresh (within TTL).
 */
export function isStale(ts: number): boolean {
  return Date.now() - ts > VOICE_TRANSCRIPT_TTL_MS;
}