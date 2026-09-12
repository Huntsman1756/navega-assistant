/**
 * Side panel entry point.
 *
 * Wires the conversation controller to the real Chrome APIs. The controller
 * holds the authoritative live session; chrome.storage.session is only a
 * recoverable ephemeral checkpoint. No provider key, no secrets, no browsing
 * history ever lives here.
 *
 * VOICE-01 / VOICE-02:
 *   voice-control.ts — TTS playback (native Audio) and STT recording (MediaRecorder)
 *   dictation page — visible fallback for microphone permission recovery
 */
import { createController, createChromeFacade } from "./controller";
import { initVoiceController, cleanupVoice, handleTranscriptMessage, canRecordVoiceAudio } from "../voice/voice-control";

const els = {
  conversation: document.getElementById("conversation") as HTMLElement,
  input: document.getElementById("question") as HTMLTextAreaElement,
  helpButton: document.getElementById("help-btn") as HTMLButtonElement,
  newHelpButton: document.getElementById("new-help-btn") as HTMLButtonElement,
  status: document.getElementById("status") as HTMLElement,
  permission: document.getElementById("permission") as HTMLElement,
  permissionText: document.getElementById("permission-text") as HTMLElement,
  permissionAllow: document.getElementById("permission-allow") as HTMLButtonElement,
  permissionDeny: document.getElementById("permission-deny") as HTMLButtonElement,
  voiceControls: document.getElementById("voice-controls") as HTMLElement,
  sttBtn: document.getElementById("voice-stt-btn") as HTMLButtonElement,
};

const modeEl = document.getElementById("mode") as HTMLElement;
modeEl.innerHTML = "Contexto: <strong>solo DOM</strong>";

const controller = createController(createChromeFacade(chrome), els);
controller.init();

els.helpButton.addEventListener("click", () => void controller.askHelp());
els.newHelpButton.addEventListener("click", () => void controller.reset());
els.permissionAllow.addEventListener("click", () => void controller.allowOrigin());
els.permissionDeny.addEventListener("click", () => void controller.denyOrigin());

els.input.addEventListener("keydown", (event) => {
  controller.onKeydown(event);
});

/* ------------------------------------------------------------------ */
/*  Voice controller wiring                                            */
/* ------------------------------------------------------------------ */

if (els.voiceControls && els.sttBtn && canRecordVoiceAudio()) {
  els.voiceControls.hidden = false;

  const voice = initVoiceController({
    sttBtn: els.sttBtn,
    status: els.status,
    input: els.input,
  });

  controller.setVoiceHandle(voice);

  els.sttBtn.addEventListener("click", () => {
    if (voice.isRecording()) {
      voice.stopRecording();
    } else {
      void voice.startRecording();
    }
  });

  // Listen for transcript messages from the dictation page or storage fallback.
  chrome?.runtime?.onMessage.addListener((message: unknown) => {
    if (handleTranscriptMessage(message)) return;
  });

  // Listen for chrome.storage.session changes (fallback delivery).
  chrome?.storage?.session?.onChanged?.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (key.startsWith("_nav_voice_transcript_")) {
        const data = change.newValue as { text?: string; ts?: number } | undefined;
        if (data?.text && data.ts) {
          handleTranscriptMessage({ type: "VOICE_TRANSCRIPT", text: data.text, ts: data.ts });
          // Consume-once: delete immediately after reading.
          void chrome.storage.session.remove(key);
        }
      }
    }
  });
}

// Cleanup on page hide (navigate away, extension disabled, etc.).
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cleanupVoice();
  }
});
