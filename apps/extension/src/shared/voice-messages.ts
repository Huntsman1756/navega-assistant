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

export type VoiceFeature = "speech" | "transcribe";

/**
 * Map a failed backend voice response to a specific Spanish status message.
 *
 * A 404 means the running backend build does not expose the voice endpoints
 * at all (e.g. the frozen G1 runtime serving 8787 while the voice-capable
 * candidate extension points at it). That must be distinguishable from a
 * missing key (503), an upstream timeout (504) or a plain network failure
 * (status 0) — otherwise the user just hears nothing and the operator debugs
 * blind.
 */
export function voiceErrorMessage(feature: VoiceFeature, status: number, code?: string): string {
  if (status === 404) {
    return "El backend no ofrece voz: usa el backend de la versión con voz.";
  }
  if (status === 503) {
    return "Falta la clave de voz en el backend.";
  }
  if (status === 504) {
    return feature === "speech"
      ? "El servicio de voz tardó demasiado. Inténtalo de nuevo."
      : "El servicio de transcripción tardó demasiado. Inténtalo de nuevo.";
  }
  if (code === "audio_too_large") {
    return "La grabación es demasiado grande para el backend.";
  }
  if (status === 0) {
    return "No se pudo conectar con el backend de voz.";
  }
  return feature === "speech"
    ? "No se pudo generar el audio. Inténtalo de nuevo."
    : "No se pudo transcribir. Inténtalo de nuevo.";
}