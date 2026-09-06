/**
 * Voice controller: TTS playback and STT recording.
 *
 * Implements VOICE-01 (read answer aloud) and VOICE-02 (dictate question by voice).
 *
 * Adapted upstream patterns:
 * - Hermes Browser Extension (MIT): MediaRecorder lifecycle, MIME selection,
 *   stream track cleanup, transcript delivery, transition guards, stale protection,
 *   permission recovery architecture.
 *   Commit: 64f2abe443dddee78313e3b18169474cbd0f4f95
 *   Files: extension/sidepanel.js (lines 3718-4307), extension/voice-dictation.js
 * - whisper-web-extension (MIT): state machine concept, MIME detection loop.
 *   Commit: d98d7c078f4e1e6a6c7752ce2f63117b4cd26da8
 * - A-Eye Web Chat Assistant (MIT): accessibility/voice UX patterns.
 *   Commit: e9284c5d9e0d26a8938e57b007f0322d7d9cc471
 * - Page Assist (MIT): per-message play/stop concept.
 *   Commit: 7a5bc71ce7a9fcb736dcce471cef5aea10d7faad
 */
import { isStale } from "../shared/voice-messages";
import { getBackendUrl } from "../shared/backend-url";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_TTS_VOICE = "ef_dora";

const MIME_ORDER = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
];

const RECORDING_LIMIT_MS = 30000;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface VoiceElements {
  ttsBtn: HTMLButtonElement;
  sttBtn: HTMLButtonElement;
  status: HTMLElement;
  input: HTMLTextAreaElement;
}

export interface VoiceHandle {
  playAnswer(assistantText: string): Promise<void>;
  stopPlaying(): void;
  startRecording(): Promise<void>;
  stopRecording(): void;
  isPlaying(): boolean;
  isRecording(): boolean;
}

/* ------------------------------------------------------------------ */
/*  Internal state                                                    */
/* ------------------------------------------------------------------ */

let audioEl: AudioElement | null = null;
let ttsPlaying = false;
let ttsAudioBlobUrl: string | null = null;

let mediaRecorder: MediaRecorder | null = null;
let recordingStream: MediaStream | null = null;
let recordingChunks: Blob[] = [];
let sttRecording = false;
let voiceTransitionInFlight = false;
let recordingTimer: ReturnType<typeof setTimeout> | null = null;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function getBackendBaseUrl(): Promise<string> {
  try {
    return await getBackendUrl();
  } catch {
    return "http://localhost:8787";
  }
}

function setStatus(text: string): void {
  if (typeof performance !== "undefined") {
    console.log(`[perf] voice_status=${text}`);
  }
}

function setTtsBtnPlaying(playing: boolean): void {
  if (playing) {
    ttsBtnEl.textContent = "Detener";
    ttsBtnEl.setAttribute("aria-label", "Detener reproducci\u00F3n de audio");
  } else {
    ttsBtnEl.textContent = "Escuchar";
    ttsBtnEl.setAttribute("aria-label", "Escuchar respuesta con voz");
  }
}

function setSttBtnRecording(recording: boolean): void {
  if (recording) {
    sttBtnEl.textContent = "Detener grabaci\u00F3n";
    sttBtnEl.setAttribute("aria-label", "Detener grabaci\u00F3n de voz");
    sttBtnEl.classList.add("recording");
  } else {
    sttBtnEl.textContent = "Hablar";
    sttBtnEl.setAttribute("aria-label", "Iniciar grabaci\u00F3n de voz");
    sttBtnEl.classList.remove("recording");
  }
}

function clearRecordingTimer(): void {
  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = null;
  }
}

export function canRecordVoiceAudio(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

function findSupportedMime(): string {
  for (const mime of MIME_ORDER) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "";
}

function stopAllTracks(stream: MediaStream | null): void {
  stream?.getTracks?.().forEach((track) => track.stop());
}

/* ------------------------------------------------------------------ */
/*  DOM references (set by initVoiceController)                       */
/* ------------------------------------------------------------------ */

let ttsBtnEl: HTMLButtonElement;
let sttBtnEl: HTMLButtonElement;
let statusEl: HTMLElement;
let inputEl: HTMLTextAreaElement;

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Initialize the voice controller with the required DOM elements.
 * Returns a handle with the public methods.
 */
export function initVoiceController(els: VoiceElements): VoiceHandle {
  ttsBtnEl = els.ttsBtn;
  sttBtnEl = els.sttBtn;
  statusEl = els.status;
  inputEl = els.input;

  return {
    playAnswer,
    stopPlaying,
    startRecording,
    stopRecording,
    isPlaying: () => ttsPlaying,
    isRecording: () => sttRecording,
  };
}

/**
 * VOICE-01: Fetch TTS audio from the backend and play it natively.
 *
 * Uses the NaN Kokoro endpoint (POST /v1/speech).
 * Button toggles: [Escuchar] \u2192 [Detener] (while playing/generating).
 */
async function playAnswer(assistantText: string): Promise<void> {
  if (ttsPlaying) {
    stopPlaying();
    return;
  }
  if (!assistantText || assistantText.trim().length === 0) return;
  if (voiceTransitionInFlight) return;

  voiceTransitionInFlight = true;
  ttsPlaying = true;
  setTtsBtnPlaying(true);
  setStatus("Generando audio\u2026");
  statusEl.setAttribute("aria-busy", "true");

  try {
    const baseUrl = await getBackendBaseUrl();
    const res = await fetch(`${baseUrl}/v1/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: assistantText, voice: DEFAULT_TTS_VOICE }),
      signal: AbortSignal.timeout(35000),
    });

    if (!res.ok) {
      setStatus("No se pudo generar el audio. Int\u00E9ntalo de nuevo.");
      ttsPlaying = false;
      setTtsBtnPlaying(false);
      statusEl.removeAttribute("aria-busy");
      return;
    }

    const blob = await res.blob();
    setStatus("Reproduciendo\u2026");

    audioEl = new Audio();
    ttsAudioBlobUrl = URL.createObjectURL(blob);
    audioEl.src = ttsAudioBlobUrl;

    audioEl.addEventListener("ended", () => {
      ttsPlaying = false;
      setTtsBtnPlaying(false);
      statusEl.removeAttribute("aria-busy");
      setStatus("");
      if (ttsAudioBlobUrl) {
        URL.revokeObjectURL(ttsAudioBlobUrl);
        ttsAudioBlobUrl = null;
      }
      audioEl = null;
    });

    audioEl.addEventListener("error", () => {
      ttsPlaying = false;
      setTtsBtnPlaying(false);
      statusEl.removeAttribute("aria-busy");
      setStatus("Error al reproducir el audio.");
      if (ttsAudioBlobUrl) {
        URL.revokeObjectURL(ttsAudioBlobUrl);
        ttsAudioBlobUrl = null;
      }
      audioEl = null;
    });

    await audioEl.play();
  } catch {
    ttsPlaying = false;
    setTtsBtnPlaying(false);
    statusEl.removeAttribute("aria-busy");
    setStatus("No se pudo generar el audio. Int\u00E9ntalo de nuevo.");
  } finally {
    voiceTransitionInFlight = false;
  }
}

/**
 * Stop TTS playback immediately.
 */
function stopPlaying(): void {
  if (!ttsPlaying) return;
  if (audioEl) {
    audioEl.pause();
    audioEl.src = "";
    audioEl = null;
  }
  ttsPlaying = false;
  setTtsBtnPlaying(false);
  statusEl.removeAttribute("aria-busy");
  setStatus("");
  if (ttsAudioBlobUrl) {
    URL.revokeObjectURL(ttsAudioBlobUrl);
    ttsAudioBlobUrl = null;
  }
}

/**
 * VOICE-02: Start recording voice input via MediaRecorder.
 *
 * Adapted from Hermes Browser Extension permission recovery pattern.
 * Tries getUserMedia directly; if blocked, opens the visible dictation page.
 * 30-second safety limit enforced.
 */
async function startRecording(): Promise<void> {
  if (sttRecording) return;
  if (voiceTransitionInFlight) return;
  if (!canRecordVoiceAudio()) {
    setStatus("El micr\u00F3fono no est\u00E1 disponible en este navegador.");
    return;
  }

  voiceTransitionInFlight = true;
  sttRecording = true;
  recordingChunks = [];
  setSttBtnRecording(true);
  setStatus("Escuchando\u2026");
  statusEl.setAttribute("aria-busy", "true");

  // 30-second recording safety limit (per spec).
  recordingTimer = setTimeout(async () => {
    if (sttRecording) {
      setStatus("L\u00EDmite de tiempo alcanzado. Transcribiendo...");
      stopRecording();
    }
  }, RECORDING_LIMIT_MS);

  const selectedMime = findSupportedMime();
  const constraints: MediaStreamConstraints = {
    audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    recordingStream = stream;

    const recorder = new MediaRecorder(stream, selectedMime ? { mimeType: selectedMime } : undefined);
    mediaRecorder = recorder;

    recorder.ondataavailable = (event: BlobEvent): void => {
      if (event.data.size > 0) {
        recordingChunks.push(event.data);
      }
    };

    recorder.start(1000); // collect 1s chunks

    recorder.onstop = async (): Promise<void> => {
      await onRecordingStopped();
    };
  } catch (err) {
    clearRecordingTimer();
    // If getUserMedia fails (permission denied / not available),
    // fall back to the visible dictation page (Hermes pattern).
    const isPermissionError =
      err instanceof DOMException &&
      (err.name === "NotAllowedError" || err.name === "NotFoundError" || err.name === "UnknownError");

    if (isPermissionError) {
      sttRecording = false;
      setSttBtnRecording(false);
      statusEl.removeAttribute("aria-busy");
      setStatus("Se requiere permiso del micr\u00F3fono. Abriendo p\u00E1gina de dictado\u2026");
      try {
        const dictationUrl = chrome.runtime.getURL("voice/dictation.html");
        window.open(dictationUrl, "_blank", "width=500,height=400");
        voiceTransitionInFlight = false;
      } catch {
        setStatus("No se pudo abrir la p\u00E1gina de dictado. Verifica los permisos del micr\u00F3fono.");
        voiceTransitionInFlight = false;
      }
    } else {
      sttRecording = false;
      setSttBtnRecording(false);
      statusEl.removeAttribute("aria-busy");
      setStatus("No se pudo acceder al micr\u00F3fono. Int\u00E9ntalo de nuevo.");
      voiceTransitionInFlight = false;
    }
  }
}

/**
 * Stop recording and send audio to NaN Whisper for transcription.
 */
function stopRecording(): void {
  clearRecordingTimer();
  if (!sttRecording || !mediaRecorder) return;
  try {
    mediaRecorder.stop();
    mediaRecorder = null;
  } catch {
    // Already stopped
  }
  stopAllTracks(recordingStream);
  recordingStream = null;
}

/**
 * Internal: called when MediaRecorder stops. Sends audio to STT backend.
 */
async function onRecordingStopped(): Promise<void> {
  if (!sttRecording) return;

  sttRecording = false;
  setSttBtnRecording(false);
  clearRecordingTimer();
  setStatus("Transcribiendo\u2026");

  const blob = new Blob(recordingChunks, { type: recordingChunks[0]?.type ?? "audio/webm" });
  recordingChunks = [];

  if (blob.size === 0) {
    setStatus("No se grab\u00F3 audio. Int\u00E9ntalo de nuevo.");
    voiceTransitionInFlight = false;
    return;
  }

  const sttForm = new FormData();
  sttForm.append("file", blob, "recording.webm");
  sttForm.append("language", "es");

  try {
    const baseUrl = await getBackendBaseUrl();
    const res = await fetch(`${baseUrl}/v1/transcribe`, {
      method: "POST",
      body: sttForm,
      signal: AbortSignal.timeout(65000),
    });

    if (!res.ok) {
      setStatus("No se pudo transcribir. Int\u00E9ntalo de nuevo.");
      voiceTransitionInFlight = false;
      return;
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data.text !== "string" || data.text.trim().length === 0) {
      setStatus("Transcripci\u00F3n vac\u00EDa. Int\u00E9ntalo de nuevo.");
      voiceTransitionInFlight = false;
      return;
    }

    deliverTranscript(data.text);
  } catch {
    setStatus("No se pudo transcribir. Int\u00E9ntalo de nuevo.");
    voiceTransitionInFlight = false;
  }
}

/**
 * Deliver a transcript to the composer textarea.
 * The user MUST review and edit before submitting.
 * NEVER auto-submit.
 */
function deliverTranscript(text: string): void {
  const ts = Date.now();

  if (isStale(ts)) {
    console.warn("[navega] voice: transcript discarded (stale)");
    voiceTransitionInFlight = false;
    setStatus("Transcripci\u00F3n expirada. Int\u00E9ntalo de nuevo.");
    return;
  }

  const current = inputEl.value.trim();
  const newText = current ? `${current} ${text.trim()}` : text.trim();

  inputEl.value = newText;
  setStatus("");
  voiceTransitionInFlight = false;
}

/* ------------------------------------------------------------------ */
/*  Transcript message handler                                        */
/* ------------------------------------------------------------------ */

/**
 * Handle incoming voice transcript messages (from dictation page or
 * chrome.runtime.sendMessage fallback).
 *
 * Returns true if the message was consumed.
 */
export function handleTranscriptMessage(message: unknown): boolean {
  const msg = message as { type?: string; text?: string; ts?: number } | undefined;
  if (msg?.type !== "VOICE_TRANSCRIPT" || typeof msg.text !== "string") return false;

  const ts = msg.ts ?? Date.now();
  if (isStale(ts)) {
    console.warn("[navega] voice: transcript discarded (stale)");
    return true;
  }

  deliverTranscript(msg.text);
  return true;
}

/* ------------------------------------------------------------------ */
/*  Cleanup                                                           */
/* ------------------------------------------------------------------ */

/**
 * Stop all voice activity and clean up all resources.
 * Must be called on navigation or page hide.
 */
export function cleanupVoice(): void {
  stopPlaying();
  if (sttRecording) {
    sttRecording = false;
    setSttBtnRecording(false);
    statusEl.removeAttribute("aria-busy");
    setStatus("");
  }
  voiceTransitionInFlight = false;
  clearRecordingTimer();
  stopAllTracks(recordingStream);
  recordingStream = null;
  mediaRecorder = null;
  recordingChunks = [];
}